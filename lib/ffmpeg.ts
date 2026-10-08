/**
 * Camada FFmpeg.wasm — roda 100% no navegador.
 *
 * - Usa o core SINGLE-THREAD (@ffmpeg/core) servido da nossa própria origem
 *   em /ffmpeg/ffmpeg-core.{js,wasm} (build ESM, copiado no build por
 *   scripts/copy-ffmpeg-core.mjs). O ESM é o caminho principal: o worker do
 *   @ffmpeg/ffmpeg importa o core via `await import(coreURL)` e exige
 *   `export default`. Para navegadores sem `import()` dinâmico no worker
 *   (ex.: Safari/WebKit), há fallback para `ffmpeg-core.classic.js`
 *   (importScripts-compatível, gerado no mesmo script de cópia).
 * - NÃO exige SharedArrayBuffer nem headers COOP/COEP.
 * - NUNCA importar este módulo no servidor: todas as funções verificam `window`.
 *
 * Configuração definitiva (referência oficial do projeto — NÃO alterar):
 *   ffmpeg -i entrada -vf "transpose=1,scale=1920:1080"
 *     -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p
 *     -x264-params "ref=1:bframes=2" -r 30 -crf 18
 *     -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart NOME_TV1080P.mp4
 * Testada fisicamente na TV 1080p P40VIK. Sem filtros extras, sem
 * pós-processamento, sem troca de CRF — só exatamente isto.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { getExtension } from "./format";

/**
 * O entry que o webpack resolve de `@ffmpeg/ffmpeg` não exporta o enum
 * `FFFSType` em runtime (só em tipos). Usamos o literal com o tipo extraído
 * da assinatura do `mount` — sem importar o enum.
 */
type MountFsType = Parameters<FFmpeg["mount"]>[0];
const WORKERFS = "WORKERFS" as unknown as MountFsType;

/**
 * Nome de download seguindo a lógica do script de referência:
 * `anuncio.mp4 → anuncio_TV1080P.mp4`.
 * Remove só a extensão original e caracteres ilegais em nomes de arquivo;
 * preserva espaços, acentos e pontos do nome original.
 */
export function makeTV1080pFilename(originalName: string): string {
  const withoutExt = originalName.replace(/\.[^/.]*$/, "").trim() || "video";
  const safe =
    withoutExt
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "video";
  return `${safe}_TV1080P.mp4`;
}

/** Nome interno dentro do FS virtual do FFmpeg (fixo e ASCII, evita problemas). */
const INTERNAL_OUTPUT = "saida_TV1080P.mp4";

/** Versão do core instalada — usada só como fallback CDN se /ffmpeg falhar. */
const CORE_VERSION = "0.12.10";
/** Versão do @ffmpeg/ffmpeg instalada — usada no fallback CDN do worker. */
const FFMPEG_VERSION = "0.12.15";

/**
 * URL do class worker (worker.js copiado para public/ffmpeg pelo
 * scripts/copy-ffmpeg-core.mjs). Passar `classWorkerURL` é ESSENCIAL:
 * sem ele, o webpack (dev e build) empacota o worker interno da lib e
 * sequestra o `await import(coreURL)` dinâmico, trocando-o por um `require`
 * de contexto que falha para qualquer URL absoluta ("Cannot find module
 * 'http://...'"). Com o worker servido como arquivo estático, o `import()`
 * é nativo e funciona normalmente.
 */
async function resolveClassWorkerURL(): Promise<{ url: string; label: string }> {
  const local = `${window.location.origin}/ffmpeg/worker.js`;
  try {
    const res = await fetch(local, { method: "GET" });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && !/html/i.test(ct)) {
      const text = await res.text();
      if (text.includes("importScripts(")) return { url: local, label: "worker local" };
    }
  } catch {
    /* usa o fallback CDN abaixo */
  }
  // Fallback: o worker original no unpkg (imports relativos ./const.js e
  // ./errors.js resolvem no próprio unpkg; CORS aberto).
  return {
    url: `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/worker.js`,
    label: "worker CDN (unpkg)",
  };
}

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let busy = false;

export function isConverting(): boolean {
  return busy;
}

function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("O FFmpeg só pode rodar no navegador, não no servidor.");
  }
}

type CoreKind = "esm" | "classic-file" | "classic-runtime" | "mt";
type CoreUrls = {
  label: string;
  kind: CoreKind;
  /** Para esm/classic-file: URL final entregue ao worker. Para classic-runtime: URL do ESM a baixar e transformar. */
  coreURL: string;
  wasmURL: string;
  /** Só no MT: worker de pthreads do core-mt. */
  workerURL?: string;
};

/**
 * Multi-thread disponível? Exige SharedArrayBuffer + página isolada
 * (headers COOP/COEP em next.config.ts). ~3-4x mais rápido no desktop.
 * Sem isso, cai para single-thread (mais lento, mas universal).
 */
/** Página isolada (COOP/COEP)? Sem isso, SharedArrayBuffer é bloqueado. */
export function isPageIsolated(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof self !== "undefined" &&
      (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    );
  } catch {
    return false;
  }
}

function isIOSWebKit(): boolean {
  try {
    const ua = navigator.userAgent;
    const platform = navigator.platform;
    const touchMac = platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || touchMac;
  } catch {
    return false;
  }
}

function supportsMT(): boolean {
  // O core-mt fica DESATIVADO por padrão. Há casos conhecidos em Chromium
  // onde exec() trava durante filtros/resize, enquanto o core single-thread
  // funciona normalmente. Para testar MT explicitamente, use ?motor=mt.
  if (isIOSWebKit() || !isPageIsolated()) return false;
  try {
    return new URLSearchParams(window.location.search).get("motor") === "mt";
  } catch {
    return false;
  }
}

/** `?motor=st` na URL força single-thread (útil se o MT travar na máquina). */
function mtForcedOff(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("motor") === "st";
  } catch {
    return false;
  }
}

/** `?io=memfs` na URL pula o WORKERFS (cópia integral; diagnóstico). */
function workfsDisabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("io") === "memfs";
  } catch {
    return false;
  }
}

function forceWorkFS(): boolean {
  try {
    // No iPhone/iPad, não copiar o vídeo inteiro para o MEMFS. Isso reduz
    // drasticamente o pico de memória antes/depois do encode.
    return isIOSWebKit() && !workfsDisabled();
  } catch {
    return false;
  }
}

export type EngineInfo = {
  engine: "mt" | "st";
  threads: number;
  isolated: boolean;
};
let engineInfo: EngineInfo | null = null;
/** Motor da instância carregada (null se nada carregado). Para exibir na UI. */
export function getEngineInfo(): EngineInfo | null {
  return engineInfo;
}

function cpuThreads(): number {
  try {
    const n =
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
    return typeof n === "number" && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function coreCandidates(): CoreUrls[] {
  // Ordem:
  //  1. ESM local (caminho padrão da lib);
  //  2. classic local em arquivo (importScripts, sem `import()` dinâmico —
  //     gerado por `npm run copy:ffmpeg`; 404 aqui só diz que o copy não rodou);
  //  3. ESM via CDN;
  //  4-5. classic gerado EM RUNTIME a partir do ESM (local e CDN): baixa o ESM
  //     com fetch normal (que funciona), remove `export`/`import.meta` e
  //     entrega um blob: para `importScripts()` — primitiva universal em
  //     workers clássicos, sem `import()` dinâmico em nenhum ponto.
  // URLs diretas http(s) para `import()` — NUNCA blob: (alguns navegadores
  // recusam `import()` de blob: no worker).
  const base = window.location.origin;
  const unpkgEsm = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
  const list: CoreUrls[] = [];
  if (supportsMT() && !mtForcedOff()) {
    // Multi-thread primeiro quando há isolamento (bem mais rápido).
    // Mesmos ARGS de codificação — só o motor muda.
    list.push({
      label: "servidor local MT multi-thread (/ffmpeg/mt/)",
      kind: "mt",
      coreURL: `${base}/ffmpeg/mt/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg/mt/ffmpeg-core.wasm`,
      workerURL: `${base}/ffmpeg/mt/ffmpeg-core.worker.js`,
    });
  }
  list.push(
    {
      label: "servidor local ESM (/ffmpeg/)",
      kind: "esm",
      coreURL: `${base}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg/ffmpeg-core.wasm`,
    },
    {
      label: "servidor local classic (/ffmpeg/)",
      kind: "classic-file",
      coreURL: `${base}/ffmpeg/ffmpeg-core.classic.js`,
      wasmURL: `${base}/ffmpeg/ffmpeg-core.wasm`,
    },
    {
      label: "CDN ESM (unpkg)",
      kind: "esm",
      coreURL: `${unpkgEsm}/ffmpeg-core.js`,
      wasmURL: `${unpkgEsm}/ffmpeg-core.wasm`,
    },
    {
      label: "classic local gerado em runtime",
      kind: "classic-runtime",
      coreURL: `${base}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg/ffmpeg-core.wasm`,
    },
    {
      label: "classic CDN gerado em runtime",
      kind: "classic-runtime",
      coreURL: `${unpkgEsm}/ffmpeg-core.js`,
      wasmURL: `${unpkgEsm}/ffmpeg-core.wasm`,
    },
  );
  return list;
}

type ResolvedCore =
  | { coreURL: string; wasmURL: string; workerURL?: string; revoke?: string }
  | { error: string };

/**
 * Transforma o ESM em classic-script para `importScripts()`:
 *  - `import.meta.url` -> `self.location.href` (`import.meta` não existe
 *    em classic scripts);
 *  - remove a linha `export default ...` (sintaxe ESM);
 *  - expõe `self.createFFmpegCore` explicitamente.
 * Retorna null se o texto não estiver no formato esperado.
 */
function esmToClassic(text: string): string | null {
  if (!text.includes("export default")) return null;
  const out = text
    .replace(/import\.meta\.url/g, "self.location.href")
    .replace(/export\s+default\s+createFFmpegCore\s*;?/, "");
  if (out.includes("import.meta")) return null;
  if (/(^|\n)\s*export[\s{]/.test(out)) return null;
  return out + "\nself.createFFmpegCore=createFFmpegCore;\n";
}

/**
 * Pré-checagem + preparo antes de entregar URLs ao worker: confirma que o
 * arquivo existe, veio como JavaScript e está no formato esperado.
 * Sem isso, uma falha vira o enigmático "Cannot find module" lá dentro.
 */
async function resolveCandidate(urls: CoreUrls): Promise<ResolvedCore> {
  try {
    const res = await fetch(urls.coreURL, { method: "GET" });
    if (!res.ok) return { error: `${urls.label}: HTTP ${res.status} ao buscar o conversor` };
    const ct = res.headers.get("content-type") ?? "";
    if (/html/i.test(ct))
      return { error: `${urls.label}: respondeu HTML em vez de JavaScript (arquivo ausente no servidor?)` };
    // O navegador cacheia; o worker reutiliza o cache em seguida.
    const text = await res.text();
    if (urls.kind === "mt") {
      if (!text.includes("export default"))
        return { error: `${urls.label}: o arquivo MT não é o build ESM esperado` };
      if (!urls.workerURL)
        return { error: `${urls.label}: worker de pthreads não configurado` };
      try {
        const wres = await fetch(urls.workerURL, { method: "GET" });
        const wct = wres.headers.get("content-type") ?? "";
        if (!wres.ok || /html/i.test(wct))
          return { error: `${urls.label}: worker de pthreads ausente (HTTP ${wres.status}) — rode npm run copy:ffmpeg` };
      } catch (e) {
        return { error: `${urls.label}: worker de pthreads inacessível (${e instanceof Error ? e.message : String(e)})` };
      }
      return { coreURL: urls.coreURL, wasmURL: urls.wasmURL, workerURL: urls.workerURL };
    }
    if (urls.kind === "esm") {
      if (!text.includes("export default"))
        return { error: `${urls.label}: o arquivo não é o build ESM esperado` };
      return { coreURL: urls.coreURL, wasmURL: urls.wasmURL };
    }
    if (urls.kind === "classic-file") {
      if (text.includes("import.meta") || /(^|\n)\s*export[\s{]/.test(text))
        return { error: `${urls.label}: o arquivo classic não é importScripts-compatível` };
      return { coreURL: urls.coreURL, wasmURL: urls.wasmURL };
    }
    // classic-runtime: baixa o ESM (fetch normal, que funciona), transforma
    // AQUI no window e entrega um blob: para `importScripts()`, primitiva
    // universal em workers clássicos — sem `import()` dinâmico em nenhum ponto.
    const classic = esmToClassic(text);
    if (!classic)
      return { error: `${urls.label}: ESM em formato inesperado para transformar` };
    const blobUrl = URL.createObjectURL(
      new Blob([classic], { type: "text/javascript" }),
    );
    return { coreURL: blobUrl, wasmURL: urls.wasmURL, revoke: blobUrl };
  } catch (e) {
    return { error: `${urls.label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Teste de fumaça: roda `ffmpeg -version` (instantâneo) para provar que o
 * `exec` funciona NESTE motor antes de entregar a instância. Se o núcleo
 * trava no exec (ex.: deadlock de threads do MT, worker morto), cai aqui em
 * até 45s com mensagem clara — em vez de congelar a conversão em 3%.
 * Retorna null se OK ou a descrição da falha.
 */
async function smokeTest(ffmpeg: FFmpeg, label: string): Promise<string | null> {
  try {
    const code = await Promise.race([
      ffmpeg.exec(["-version"]),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("travou sem responder")), 45000),
      ),
    ]);
    if (code !== 0) return `${label}: smoke test retornou código ${code}`;
    return null;
  } catch (e) {
    return `${label}: exec não responde (${e instanceof Error ? e.message : String(e)})`;
  }
}

/**
 * Carrega (uma única vez) o FFmpeg.wasm. Seguro para chamar várias vezes:
 * retorna a mesma instância.
 */
export async function loadFFmpeg(
  onLog?: (message: string) => void,
): Promise<FFmpeg> {
  assertBrowser();
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const failures: string[] = [];
    const ownedBlobs: string[] = [];
    const releaseBlobs = () => {
      for (const u of ownedBlobs.splice(0)) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignora */
        }
      }
    };
    // Worker estático (ver resolveClassWorkerURL): sem ele, o bundler
    // sequestra o `import()` dinâmico do worker interno.
    const classWorker = await resolveClassWorkerURL();
    try {
      for (const urls of coreCandidates()) {
        const resolved = await resolveCandidate(urls);
        if ("error" in resolved) {
          failures.push(resolved.error);
          continue;
        }
        if (resolved.revoke) ownedBlobs.push(resolved.revoke);
        // Instância nova a cada tentativa: um load falho pode deixar o worker
        // em estado inconsistente.
        const ffmpeg = new FFmpeg();
        if (onLog) {
          ffmpeg.on("log", ({ message }) => onLog(message));
        }
        try {
          // classWorkerURL = worker estático servido por nós (nativo, fora do
          // bundler). Sem ele, o webpack sequestra o `import()` dinâmico.
          // workerURL = pthreads, só no MT (single-thread não usa).
          await ffmpeg.load({
            classWorkerURL: classWorker.url,
            coreURL: resolved.coreURL,
            wasmURL: resolved.wasmURL,
            ...(resolved.workerURL ? { workerURL: resolved.workerURL } : {}),
          });
          // O load resolver NÃO prova que o exec funciona: valida com fumaça.
          const smoke = await smokeTest(ffmpeg, urls.label);
          if (smoke) {
            failures.push(`${smoke} [${classWorker.label}]`);
            try {
              ffmpeg.terminate();
            } catch {
              /* ignora */
            }
            continue;
          }
          ffmpegInstance = ffmpeg;
          engineInfo = {
            engine: resolved.workerURL ? "mt" : "st",
            threads: cpuThreads(),
            isolated: supportsMT(),
          };
          return ffmpeg;
        } catch (e) {
          failures.push(
            `${urls.label} [${classWorker.label}]: ${e instanceof Error ? e.message : String(e)}`,
          );
          try {
            ffmpeg.terminate();
          } catch {
            /* ignora */
          }
        }
      }
      throw new Error(
        "Não consegui carregar o conversor no seu navegador. " +
          "Verifique sua internet e recarregue a página. " +
          `Detalhes: ${failures.join(" | ")}`,
      );
    } finally {
      // O worker já avaliou os scripts a essa altura; liberar os blobs
      // economiza memória sem quebrar a instância carregada.
      releaseBlobs();
    }
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

export type ConvertCallbacks = {
  onProgress?: (percent: number) => void;
  onLog?: (message: string) => void;
};

function sanitizeExtension(fileName: string): string {
  const ext = getExtension(fileName).replace(/[^a-z0-9]/g, "");
  return ext || "mp4";
}

/**
 * Converte o vídeo exatamente no padrão da TV 1080p.
 * Retorna um Blob MP4 pronto para download.
 */
export async function convertVideoForTV1080p(
  file: File,
  callbacks: ConvertCallbacks = {},
): Promise<Blob> {
  assertBrowser();
  if (busy) {
    throw new Error(
      "Já existe uma conversão em andamento. Aguarde terminar antes de começar outra.",
    );
  }
  busy = true;

  const ffmpeg = await loadFFmpeg();

  const ext = sanitizeExtension(file.name);
  const inputName = `entrada.${ext}`;
  const outputName = INTERNAL_OUTPUT;
  const MOUNT_POINT = "/work";
  let mounted = false;
  let writtenInput: string | null = null;

  /**
   * Disponibiliza o arquivo de entrada para o FFmpeg.
   * - Arquivos pequenos (<=100 MB): cópia integral via writeFile (caminho
   *   clássico, simples e testado).
   * - Arquivos grandes: WORKERFS (leitura sob demanda direto do Blob, SEM
   *   copiar gigabytes para o MEMFS — decisivo para vídeos longos de iPhone).
   * `?io=memfs` força a cópia integral sempre (diagnóstico).
   */
  async function stageInput(): Promise<string> {
    // Em desktop com bastante RAM, uma cópia única para o MEMFS costuma ser
    // mais rápida durante o encode do que WORKERFS, porque o FFmpeg lê os
    // frames diretamente da memória WASM. Em aparelhos com pouca memória,
    // mantemos WORKERFS para não duplicar um vídeo grande inteiro.
    const WORKERFS_LIMIT = 512 * 1024 * 1024;
    const deviceMemory =
      typeof navigator !== "undefined" && "deviceMemory" in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
        : 0;
    const prefersMemfs = deviceMemory >= 8 || (deviceMemory === 0 && file.size <= WORKERFS_LIMIT);
    const useWorkFS =
      !workfsDisabled() &&
      (forceWorkFS() || (file.size > WORKERFS_LIMIT && !prefersMemfs));
    if (useWorkFS) {
      try {
        try {
          await ffmpeg.createDir(MOUNT_POINT);
        } catch {
          /* pode já existir de uma conversão anterior */
        }
        const ok = await ffmpeg.mount(WORKERFS, { files: [file] }, MOUNT_POINT);
        if (ok) {
          mounted = true;
          callbacks.onLog?.(
            forceWorkFS()
              ? "entrada: iOS/Safari — leitura sob demanda (workfs)"
              : "entrada: leitura sob demanda (workfs)",
          );
          return `${MOUNT_POINT}/${file.name}`;
        }
        callbacks.onLog?.("entrada: workfs recusado, usando cópia local (memfs)");
      } catch {
        callbacks.onLog?.("entrada: workfs falhou, usando cópia local (memfs)");
      }
    } else {
      callbacks.onLog?.(
        prefersMemfs
          ? "entrada: MEMFS (RAM, caminho rápido)"
          : "entrada: cópia local (memfs)",
      );
    }
    // Uma única leitura do File. Em desktop com RAM suficiente, o MEMFS
    // evita o custo de chamadas de leitura do WORKERFS a cada bloco/frame.
    const data = await fetchFile(file);
    await ffmpeg.writeFile(inputName, data);
    writtenInput = inputName;
    return inputName;
  }

  // Progresso MONOTÔNICO. Além do evento progress do FFmpeg.wasm, usamos
  // Duration/time dos próprios logs como fallback. Em alguns navegadores/cores
  // o evento pode demorar a aparecer; sem isso a UI fica presa artificialmente.
  let peak = 0;
  let durationSeconds: number | null = null;

  const emit = (pct: number) => {
    if (!Number.isFinite(pct)) return;
    const clamped = Math.max(0, Math.min(97, Math.round(pct)));
    if (clamped > peak) {
      peak = clamped;
      callbacks.onProgress?.(clamped);
    }
  };

  const parseTimestamp = (value: string): number | null => {
    const m = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  };

  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    emit(progress * 100);
    if (durationSeconds != null && Number.isFinite(time) && time > 0) {
      emit((time / 1_000_000 / durationSeconds) * 100);
    }
  };
  ffmpeg.on("progress", handleProgress);

  // Listener instalado aqui para capturar logs mesmo quando o FFmpeg foi pré-carregado.
  const forwardLog = ({ message }: { type: string; message: string }) => {
    const durationMatch = message.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
    if (durationMatch) {
      const parsed = parseTimestamp(durationMatch[1]);
      if (parsed != null && parsed > 0) durationSeconds = parsed;
    }
    const timeMatch = message.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/);
    if (timeMatch && durationSeconds != null) {
      const current = parseTimestamp(timeMatch[1]);
      if (current != null) emit((current / durationSeconds) * 100);
    }
    callbacks.onLog?.(message);
  };
  ffmpeg.on("log", forwardLog);

  try {
    // 1% significa conversão iniciada; não usamos 3% artificialmente.
    emit(1);

    const stagedInput = await stageInput();

    emit(2);

    // Não fixamos threads aqui de propósito. O comando de referência também
    // não fixa threads: no core-mt, o FFmpeg/x264 pode escolher a melhor
    // paralelização disponível; no core single-thread, fica naturalmente em 1.
    // Fixar em 2 threads mostrou-se um gargalo enorme no navegador.
    const args = [
      "-i",
      stagedInput,
      "-vf",
      "transpose=1,scale=1920:1080",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "4.0",
      "-pix_fmt",
      "yuv420p",
      "-x264-params",
      "ref=1:bframes=2",
      "-r",
      "30",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outputName,
    ];

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(
        `A conversão falhou (código ${exitCode}). Tente outro vídeo ou outro navegador (Chrome/Edge costumam funcionar melhor).`,
      );
    }

    callbacks.onProgress?.(98);

    // O encode acabou, mas a entrada ainda ocupa memória no FS virtual.
    // Libere-a antes de materializar o MP4 final para evitar pico de RAM.
    if (mounted) {
      try {
        await ffmpeg.unmount(MOUNT_POINT);
      } catch {
        /* ignora */
      }
      mounted = false;
    }
    if (writtenInput) {
      try {
        await ffmpeg.deleteFile(writtenInput);
      } catch {
        /* ignora */
      }
      writtenInput = null;
    }

    const out = await ffmpeg.readFile(outputName);
    const bytes =
      typeof out === "string" ? new TextEncoder().encode(out) : out;

    // O MP4 já está no Uint8Array retornado pelo worker; remova a cópia do
    // FS virtual imediatamente, antes de criar o Blob final.
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* ignora */
    }

    callbacks.onProgress?.(99);
    return new Blob([bytes as unknown as BlobPart], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    ffmpeg.off("log", forwardLog);
    // Limpa os arquivos temporários do FS virtual (economiza memória).
    if (mounted) {
      try {
        await ffmpeg.unmount(MOUNT_POINT);
      } catch {
        /* ignora */
      }
    }
    if (writtenInput) {
      try {
        await ffmpeg.deleteFile(writtenInput);
      } catch {
        /* ignora */
      }
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* ignora */
    }
    busy = false;
  }
}

/** Libera a instância (uso raro; chamado ao desmontar em caso de erro). */
export function terminateFFmpeg() {
  try {
    ffmpegInstance?.terminate();
  } catch {
    /* ignora */
  }
  ffmpegInstance = null;
  loadPromise = null;
  busy = false;
  engineInfo = null;
}