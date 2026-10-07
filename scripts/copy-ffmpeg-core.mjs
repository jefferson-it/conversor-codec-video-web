/**
 * Copia os assets do @ffmpeg/core (single-thread) para public/ffmpeg.
 *
 * Por que isso existe?
 * - O FFmpeg.wasm precisa carregar ffmpeg-core.js + ffmpeg-core.wasm de alguma URL.
 * - O padrão da lib aponta para o unpkg (CDN externa) — frágil e pode quebrar offline/CSP.
 * - Servir os arquivos da nossa própria origem (/ffmpeg/...) funciona em
 *   `next dev`, `next start` e na Vercel sem configuração extra.
 * - Usamos de propósito o core single-thread (@ffmpeg/core), que NÃO exige
 *   SharedArrayBuffer nem headers COOP/COEP (diferente do core-mt).
 *
 * Executado via `npm run copy:ffmpeg` (postinstall + prebuild).
 */
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// @ffmpeg/core não exporta "./package.json" via `exports`,
// então localizamos pelo caminho conhecido em node_modules.
const coreRoot = path.join(projectRoot, "node_modules", "@ffmpeg", "core");

// @ffmpeg/core publica os builds em dist/esm e dist/umd.
// Usamos o ESM de propósito. Fluxo dentro do worker do @ffmpeg/ffmpeg:
//   1. tenta `importScripts(coreURL)` (worker clássico) — falha com ESM
//      (sintaxe `export`) e isso é ESPERADO;
//   2. cai no `await import(coreURL)` — que EXIGE `export default`, que só
//      o build ESM tem (o UMD termina com module.exports/define e ainda usa
//      `import.meta.url` no topo, quebrando os dois caminhos).
// Servimos via URL direta http(s) da própria origem: `import()` de blob:
// é recusado no worker em alguns navegadores (ex.: "Cannot find module
// 'blob:...'").
const candidates = [
  path.join(coreRoot, "dist", "esm"),
  path.join(coreRoot, "dist", "umd"),
];

let srcDir = null;
for (const dir of candidates) {
  try {
    const files = await readdir(dir);
    if (files.includes("ffmpeg-core.js") && files.includes("ffmpeg-core.wasm")) {
      srcDir = dir;
      break;
    }
  } catch {
    // tenta o próximo candidato
  }
}

if (!srcDir) {
  console.error("[copy:ffmpeg] Não encontrei ffmpeg-core.js/.wasm em @ffmpeg/core/dist/{esm,umd}");
  process.exit(1);
}

const destDir = path.join(projectRoot, "public", "ffmpeg");
await mkdir(destDir, { recursive: true });

for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await cp(path.join(srcDir, file), path.join(destDir, file));
  console.log(`[copy:ffmpeg] ${file} -> public/ffmpeg/${file}`);
}

// Trava de segurança: o caminho principal EXIGE o build ESM (`export default`).
// Se um dia o pacote mudar o formato, o build quebra aqui com mensagem
// clara em vez de falhar no navegador com "Cannot find module".
const js = await readFile(path.join(destDir, "ffmpeg-core.js"), "utf8");
if (!js.includes("export default")) {
  console.error(
    "[copy:ffmpeg] ERRO: ffmpeg-core.js não contém `export default`. " +
      "O worker do FFmpeg precisa do build ESM de @ffmpeg/core.",
  );
  process.exit(1);
}

// ---- Worker do @ffmpeg/ffmpeg (class worker) ----
// Por que copiar o worker para public/ffmpeg?
// O worker (node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js) faz
// `await import(coreURL)` com URL dinâmica. Quando esse arquivo é empacotado
// pelo webpack (dev e build), o bundler sequestra o `import()` dinâmico e o
// troca por um `require` de contexto — que falha para qualquer URL absoluta
// com "Cannot find module 'http://...'". Servindo o worker como arquivo
// estático e apontando-o via `classWorkerURL` (ver lib/ffmpeg.ts), o código
// roda nativo no worker, fora do alcance do bundler, e o `import()` volta a
// ser um fetch HTTP normal.
// Mantemos os nomes originais (worker.js/const.js/errors.js) para que os
// imports relativos (`./const.js`, `./errors.js`) continuem funcionando.
const ffmpegEsmDir = path.join(projectRoot, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
for (const file of ["worker.js", "const.js", "errors.js"]) {
  await cp(path.join(ffmpegEsmDir, file), path.join(destDir, file));
  console.log(`[copy:ffmpeg] ${file} -> public/ffmpeg/${file}`);
}
const workerJs = await readFile(path.join(destDir, "worker.js"), "utf8");
if (!workerJs.includes("importScripts(") || !workerJs.includes("await import(")) {
  console.error("[copy:ffmpeg] ERRO: worker.js em formato inesperado.");
  process.exit(1);
}

// ---- Variante "classic" do core ----
// Para navegadores cujo worker clássico NÃO suporta `import()` dinâmico
// (ex.: Safari/WebKit — "Cannot find module 'http://...'"), geramos
// `ffmpeg-core.classic.js`: 100% classic-script, carregável via
// `importScripts()` (primeira tentativa do worker, sem `import()` dinâmico).
// Derivado do UMD com dois ajustes:
//   1. `import.meta.url` -> `self.location.href` (`import.meta` não existe
//      em classic scripts e faria o `importScripts()` lançar);
//   2. atribuição explícita `self.createFFmpegCore = ...` (o UMD sozinho não
//      a expõe no worker, pois `module`/`define`/`exports` não existem lá).
// O app (lib/ffmpeg.ts) tenta o ESM primeiro e cai para este arquivo.
const umdPath = path.join(coreRoot, "dist", "umd", "ffmpeg-core.js");
let umdJs;
try {
  umdJs = await readFile(umdPath, "utf8");
} catch {
  console.error(`[copy:ffmpeg] ERRO: não encontrei ${umdPath}`);
  process.exit(1);
}
let classicJs = umdJs.replaceAll("import.meta.url", "self.location.href");
if (classicJs.includes("import.meta")) {
  console.error(
    "[copy:ffmpeg] ERRO: restou `import.meta` no build classic após o patch.",
  );
  process.exit(1);
}
if (/(^|\n)\s*export[\s{]/.test(classicJs) || classicJs.includes("export default")) {
  console.error(
    "[copy:ffmpeg] ERRO: sintaxe ESM `export` no build classic — " +
      "`importScripts()` recusaria o arquivo.",
  );
  process.exit(1);
}
classicJs += "\nself.createFFmpegCore=createFFmpegCore;\n";
await writeFile(path.join(destDir, "ffmpeg-core.classic.js"), classicJs);
console.log("[copy:ffmpeg] ffmpeg-core.classic.js -> public/ffmpeg/ffmpeg-core.classic.js");

// ---- Core multi-thread (@ffmpeg/core-mt) ----
// ~3-4x mais rápido no desktop (usa os núcleos da CPU via pthreads).
// Exige SharedArrayBuffer => página isolada (headers COOP/COEP em
// next.config.ts). O app usa MT só quando `crossOriginIsolated === true`;
// caso contrário cai para o single-thread. Mesmos ARGS de codificação.
const mtRoot = path.join(projectRoot, "node_modules", "@ffmpeg", "core-mt");
const mtDest = path.join(destDir, "mt");
await mkdir(mtDest, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"]) {
  try {
    await cp(path.join(mtRoot, "dist", "esm", file), path.join(mtDest, file));
    console.log(`[copy:ffmpeg] ${file} -> public/ffmpeg/mt/${file}`);
  } catch {
    console.error(`[copy:ffmpeg] ERRO: não encontrei ${file} em @ffmpeg/core-mt/dist/esm (rode npm install)`);
    process.exit(1);
  }
}
const mtJs = await readFile(path.join(mtDest, "ffmpeg-core.js"), "utf8");
if (!mtJs.includes("export default")) {
  console.error("[copy:ffmpeg] ERRO: MT ffmpeg-core.js sem `export default`.");
  process.exit(1);
}

console.log("[copy:ffmpeg] OK (ESM + classic + MT confirmados)");
