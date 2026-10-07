"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  onSelect: (file: File) => void;
};

const ACCEPT = "video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp,.ogv,.mts,.m2ts,.wmv";

export default function VideoUploader({ disabled, onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onSelect(file);
    },
    [disabled, onSelect],
  );

  return (
    <div>
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Escolher vídeo da fototeca ou arquivos"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="plus-circle" aria-hidden>
          ＋
        </div>
        <p className="dropzone-title">Escolher vídeo</p>
        <p className="dropzone-sub">
          Selecione um vídeo da sua fototeca ou arquivos
        </p>
        <p className="dropzone-drag-hint">
          No computador, você também pode arrastar o arquivo para cá
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Permite escolher o mesmo arquivo duas vezes seguidas.
            e.target.value = "";
            if (file) onSelect(file);
          }}
        />
      </div>
      <p className="hint">Seus vídeos ficam só no seu aparelho. Nada é enviado.</p>
    </div>
  );
}
