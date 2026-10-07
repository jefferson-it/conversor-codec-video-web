"use client";

import { useEffect, useState } from "react";

type Props = {
  downloadUrl: string;
  fileName: string;
  outputBlob: Blob | null;
  outputSize: number | null;
  onReset: () => void;
};

export default function DownloadResult({ downloadUrl, fileName, outputBlob, outputSize, onReset }: Props) {
  const [canShare, setCanShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    // Web Share API com arquivos (iOS Safari 15+). Detecção progressiva:
    // o botão só aparece quando o navegador realmente suporta.
    try {
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
      };
      if (typeof nav.canShare === "function" && outputBlob) {
        const probe = new File([outputBlob], fileName, { type: "video/mp4" });
        setCanShare(nav.canShare({ files: [probe] }) && typeof nav.share === "function");
      } else {
        setCanShare(false);
      }
    } catch {
      setCanShare(false);
    }
  }, [outputBlob, fileName]);

  const handleShare = async () => {
    setShareError(null);
    try {
      if (!outputBlob) return;
      const file = new File([outputBlob], fileName, { type: "video/mp4" });
      await navigator.share({
        files: [file],
        title: "Vídeo para TV 1080p",
        text: "Meu vídeo convertido para a TV 1080p.",
      });
    } catch (e) {
      // AbortError = usuário cancelou o painel — não é erro.
      if (e instanceof Error && e.name === "AbortError") return;
      setShareError(
        "Não consegui abrir o compartilhamento. Use o botão “Baixar vídeo” — ele salva o arquivo normalmente.",
      );
    }
  };

  return (
    <div className="result">
      <div className="result-check" aria-hidden>
        ✓
      </div>
      <h2>Vídeo pronto!</h2>
      <p>
        Seu vídeo está pronto para a TV 1080p.
      </p>
      <div className="result-actions">
        <a
          href={downloadUrl}
          download={fileName}
          className="btn btn-primary"
        >
          Baixar vídeo
        </a>
        {canShare && (
          <button type="button" className="btn btn-secondary-ios" onClick={handleShare}>
            Compartilhar
          </button>
        )}
        <button type="button" className="btn btn-plain" onClick={onReset}>
          Converter outro
        </button>
      </div>
      {shareError && (
        <div className="status status-warn" role="alert" style={{ marginTop: 12 }}>
          <span>{shareError}</span>
        </div>
      )}
      <p className="result-file">
        <code>{fileName}</code>
        {outputSize != null && (
          <> · {(outputSize / (1024 * 1024)).toFixed(outputSize >= 10 * 1024 * 1024 ? 0 : 1).replace(".", ",")} MB</>
        )}
        <br />
        Copie para o pendrive e coloque na TV.
      </p>
    </div>
  );
}
