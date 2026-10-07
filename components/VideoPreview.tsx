"use client";

import { formatBytes } from "@/lib/format";

type Props = {
  file: File;
  previewUrl: string | null;
  onRemove: () => void;
  disabled?: boolean;
};

export default function VideoPreview({ file, previewUrl, onRemove, disabled }: Props) {
  return (
    <div>
      {previewUrl && (
        <video
          className="preview"
          src={previewUrl}
          controls
          playsInline
          preload="metadata"
          aria-label="Prévia do vídeo selecionado"
        />
      )}
      <div className="file-row" style={{ marginTop: previewUrl ? 12 : 0 }}>
        <div className="file-thumb" aria-hidden>
          ▶
        </div>
        <div className="file-meta">
          <p className="file-name">{file.name}</p>
          <p className="file-size">{formatBytes(file.size)}</p>
        </div>
        <button
          type="button"
          className="file-remove"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remover vídeo e escolher outro"
        >
          Trocar
        </button>
      </div>
    </div>
  );
}
