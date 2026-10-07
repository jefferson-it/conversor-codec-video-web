"use client";

import { useEffect, useState } from "react";
import { downloadWebResult, convertInput, getRuntime, pickInput, runtimeLabel } from "@/lib/runtime";
import type { RuntimeInput, RuntimeProgress, RuntimeResult } from "@/lib/runtime";

type Phase = "idle" | "ready" | "working" | "done";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatExactDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  const sec = remaining.toFixed(3).replace(".", ",").padStart(6, "0");
  return minutes > 0 ? `${minutes}min ${sec}s` : `${sec}s`;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(2).replace(".", ",")} MB`;
}

function formatSizeDelta(inputBytes: number, outputBytes: number): string {
  if (!inputBytes || !outputBytes) return "—";
  const percent = ((outputBytes - inputBytes) / inputBytes) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1).replace(".", ",")}%`;
}

export default function Home() {
  const [runtime, setRuntime] = useState<"desktop" | "web" | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState<RuntimeInput | null>(null);
  const [result, setResult] = useState<RuntimeResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [fps, setFps] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [outputMegabytes, setOutputMegabytes] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => setRuntime(getRuntime()), []);

  useEffect(() => {
    if (phase !== "working" || startedAt == null) return;
    const id = window.setInterval(() => setElapsedSeconds((Date.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(id);
  }, [phase, startedAt]);

  function handleProgress(p: RuntimeProgress) {
    setProgress((old) => Math.max(old, p.percent));
    if (p.fps) setFps(p.fps.replace(".", ","));
    if (p.speed != null) setSpeed(p.speed);
    if (p.elapsedSeconds != null) setElapsedSeconds(p.elapsedSeconds);
    if (p.durationSeconds != null) setDurationSeconds(p.durationSeconds);
    if (p.outputMegabytes != null) setOutputMegabytes(p.outputMegabytes);
    if (p.speed && p.durationSeconds && p.currentSeconds != null) {
      setEtaSeconds(Math.max(0, (p.durationSeconds - p.currentSeconds) / p.speed));
    }
  }

  async function chooseVideo() {
    try {
      setError(null);
      setInfo(null);
      const selected = await pickInput();
      if (!selected) return;
      setInput(selected);
      setResult(null);
      setProgress(0);
      setOutputMegabytes(0);
      setElapsedSeconds(0);
      setDurationSeconds(null);
      setSpeed(null);
      setEtaSeconds(null);
      setFps(null);
      setPhase("ready");
      setInfo(runtime === "desktop"
        ? "Vídeo selecionado. Ao converter, você escolherá onde salvar o MP4."
        : "Vídeo selecionado. A conversão acontece neste dispositivo; ao terminar, o MP4 ficará disponível para baixar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function convert() {
    if (!input) return;
    try {
      setError(null);
      setInfo(null);
      setPhase("working");
      setProgress(0);
      setOutputMegabytes(0);
      setElapsedSeconds(0);
      setEtaSeconds(null);
      setSpeed(null);
      setFps(null);
      setDurationSeconds(null);
      setStartedAt(Date.now());
      setInfo(runtime === "desktop"
        ? "FFmpeg nativo está convertendo diretamente no computador…"
        : "FFmpeg.wasm está convertendo localmente no navegador…");

      const converted = await convertInput(input, handleProgress);
      setResult(converted);
      setProgress(100);
      setElapsedSeconds(converted.elapsedSeconds);
      setOutputMegabytes(converted.outputBytes / (1024 * 1024));
      setDurationSeconds(converted.durationSeconds);
      setSpeed(converted.speed);
      setEtaSeconds(0);
      setPhase("done");
      setInfo(null);
    } catch (e) {
      setPhase("ready");
      setStartedAt(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    if (result?.previewUrl && runtime === "web") URL.revokeObjectURL(result.previewUrl);
    setInput(null);
    setResult(null);
    setProgress(0);
    setOutputMegabytes(0);
    setElapsedSeconds(0);
    setDurationSeconds(null);
    setSpeed(null);
    setEtaSeconds(null);
    setFps(null);
    setStartedAt(null);
    setError(null);
    setInfo(null);
    setPhase("idle");
  }

  if (runtime === null) {
    return <main className="page"><div className="container"><section className="card"><h1>Conversor de Vídeo TV 1080p</h1><p>Inicializando o aplicativo…</p></section></div></main>;
  }

  const desktop = runtime === "desktop";

  return (
    <main className="page">
      <div className="container">
        <header className="hero">
          <div className="app-icon" aria-hidden>📺</div>
          <p className="hero-eyebrow">{desktop ? "Desktop · FFmpeg nativo" : "Web · FFmpeg.wasm"}</p>
          <h1>Conversor de Vídeo</h1>
          <p className="hero-sub">Conversão local para TV 1080p. O próprio aplicativo escolhe o melhor motor para onde está rodando.</p>
        </header>

        <section className="card" aria-label="Conversor de vídeo">
          {phase === "idle" && <button className="btn btn-primary" onClick={chooseVideo}>Escolher vídeo</button>}

          {input && phase !== "idle" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="status status-info"><span><strong>Entrada:</strong> {input.name} · {formatSize(input.sizeBytes)}</span></div>

              {phase === "ready" && (
                <>
                  <p className="hint">{desktop ? "Ao iniciar, o aplicativo perguntará onde salvar o MP4 e gravará diretamente no disco." : "Ao iniciar, o vídeo será processado no navegador sem ser enviado para servidor. No final, aparecerá o botão Baixar vídeo."}</p>
                  <button className="btn btn-primary" onClick={convert}>Converter vídeo</button>
                </>
              )}

              {phase === "working" && (
                <div className="conversion-progress">
                  <div className="progress-header">
                    <div><strong className="progress-percent">{progress}%</strong><span className="progress-label">convertido</span></div>
                    {fps && <span className="progress-fps">{fps} fps</span>}
                  </div>
                  <div className="progress-track-large" role="progressbar" aria-label="Progresso da conversão" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="progress-fill-large" style={{ width: `${progress}%` }}>{progress >= 12 && <span>{progress}%</span>}</div>
                  </div>
                  <div className="progress-stats">
                    <span><strong>Decorrido</strong> {formatDuration(elapsedSeconds)}</span>
                    <span><strong>Restante</strong> {formatDuration(etaSeconds)}</span>
                    {speed != null && <span><strong>Velocidade</strong> {speed.toFixed(2).replace(".", ",")}×</span>}
                    <span><strong>Saída</strong> {outputMegabytes > 0 ? formatSize(outputMegabytes * 1024 * 1024) : "calculando…"}</span>
                  </div>
                  <div className="status status-info"><span><strong>Motor:</strong> {runtimeLabel()} · {desktop ? "arquivo sendo gravado diretamente no disco" : "processamento local no navegador"}</span></div>
                  {durationSeconds != null && <p className="progress-note">Vídeo de {formatDuration(durationSeconds)} · tempo real de processamento atualizado ao vivo.</p>}
                  <p className="hint">Não feche o aplicativo ou aba durante a conversão.</p>
                </div>
              )}

              {phase === "done" && result && (
                <>
                  <div className="result">
                    <div className="result-check" aria-hidden>✓</div>
                    <h2>Conversão concluída</h2>
                    <p>{desktop ? <>O MP4 foi <strong>salvo automaticamente no disco</strong>.</> : <>O MP4 está pronto para <strong>baixar</strong>.</>}</p>
                    <div className="conversion-summary conversion-summary-final">
                      <span><strong>Tamanho original</strong>{formatSize(input.sizeBytes)}</span>
                      <span><strong>Tamanho final</strong>{formatSize(result.outputBytes)}</span>
                      <span><strong>Variação</strong>{formatSizeDelta(input.sizeBytes, result.outputBytes)}</span>
                      <span><strong>Tempo exato</strong>{formatExactDuration(result.elapsedSeconds)}</span>
                      {result.durationSeconds != null && <span><strong>Duração do vídeo</strong>{formatDuration(result.durationSeconds)}</span>}
                      {result.speed != null && <span><strong>Velocidade final</strong>{result.speed.toFixed(2).replace(".", ",")}×</span>}
                    </div>
                  </div>

                  <div className="preview-section">
                    <div className="preview-heading"><strong>Prévia do vídeo convertido</strong><span>{desktop ? "Reproduzido diretamente do arquivo salvo." : "Reproduzido diretamente do MP4 gerado no navegador."}</span></div>
                    <video className="preview preview-final" src={result.previewUrl} controls playsInline preload="metadata" />
                  </div>

                  {desktop ? (
                    <>
                      <div className="status status-info"><span><strong>Salvo em:</strong> {result.outputPath}</span></div>
                      <button className="btn btn-primary" onClick={reset}>Converter outro vídeo</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary" onClick={() => downloadWebResult(result)}>Baixar vídeo</button>
                      <p className="hint">O download é feito pelo próprio navegador, sem enviar o vídeo para servidor.</p>
                      <button className="btn btn-plain" onClick={reset}>Converter outro vídeo</button>
                    </>
                  )}
                </>
              )}

              {(error || info) && <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {error && <div className="status status-error" role="alert"><span>{error}</span></div>}
                {info && !error && <div className="status status-info" role="status"><span>{info}</span></div>}
              </div>}
            </div>
          )}
        </section>

        <section className="howto" aria-label="Como usar">
          <details><summary>Como funciona</summary>
            <ol>
              <li>O vídeo permanece no seu dispositivo.</li>
              <li>No Desktop/Tauri, o aplicativo usa FFmpeg nativo.</li>
              <li>No navegador, usa FFmpeg.wasm otimizado para o ambiente web.</li>
              <li>A saída usa H.264 High, Level 4.0, 1080p, yuv420p, 30 fps e AAC 192 kbps.</li>
              <li>No Desktop você escolhe onde salvar; na Web você baixa pelo navegador.</li>
            </ol>
          </details>
        </section>

        <p className="privacy"><strong>Privacidade:</strong> o vídeo não é enviado para nenhum servidor.</p>
        <footer className="footer">Conversor de Vídeo TV 1080p · {desktop ? "Desktop nativo" : "Web local"}</footer>
      </div>
    </main>
  );
}
