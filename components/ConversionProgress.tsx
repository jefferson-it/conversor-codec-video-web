"use client";

type Props = {
  progress: number;
  preparing: boolean;
  finalizing: boolean;
  startedAt: number | null;
};

function fmtDur(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s} s`;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

export default function ConversionProgress({
  progress,
  preparing,
  finalizing,
  startedAt,
}: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const elapsedMs = startedAt != null ? Math.max(0, Date.now() - startedAt) : 0;

  // A estimativa só usa o ritmo real de encode. Acima de 95% não projetamos
  // o restante porque o FFmpeg pode entrar em faststart/readFile, etapas cujo
  // tempo não é proporcional ao percentual do vídeo.
  const showEta = !preparing && !finalizing && startedAt != null && pct >= 5 && pct < 95;
  const remainingMs = showEta ? (elapsedMs * (100 - pct)) / Math.max(pct, 1) : 0;

  let title = "Convertendo seu vídeo";
  if (preparing) title = "Preparando o conversor…";
  else if (finalizing) title = "Finalizando o arquivo…";

  return (
    <div className="converting" role="status" aria-live="polite">
      <p className="converting-title">{title}</p>
      <p className="converting-pct" aria-label={`${pct} por cento`}>
        {pct}%
      </p>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Progresso da conversão"
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-note">
        {startedAt != null && !preparing && (
          <>
            Tempo decorrido: {fmtDur(elapsedMs)}
            {showEta && (
              <>
                <br />
                Faltam aprox. {fmtDur(remainingMs)}
              </>
            )}
            {finalizing && (
              <>
                <br />
                O encode terminou; preparando o arquivo final para download.
              </>
            )}
            <br />
          </>
        )}
        Vídeos longos podem levar vários minutos.
        <br />
        O vídeo está sendo processado no seu próprio dispositivo.
      </p>
    </div>
  );
}
