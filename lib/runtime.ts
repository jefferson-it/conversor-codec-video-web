import type { RuntimeInput, RuntimeProgress, RuntimeResult } from "./runtime-types";
import { convertVideoForTV1080p } from "./ffmpeg";

export type { RuntimeInput, RuntimeProgress, RuntimeResult };
export type Runtime = "desktop" | "web";

export function getRuntime(): Runtime { return "web"; }
export function runtimeLabel(): string { return "FFmpeg.wasm"; }

export async function pickInput(): Promise<RuntimeInput | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file ? { name: file.name, sizeBytes: file.size, file } : null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function getVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 5000);
    video.src = url;
  });
}

export async function convertInput(input: RuntimeInput, onProgress?: (p: RuntimeProgress) => void): Promise<RuntimeResult> {
  if (!input.file) throw new Error("Arquivo de entrada não disponível.");
  const durationSeconds = await getVideoDuration(input.file);
  const startedAt = performance.now();
  let estimatedMegabytes = 0;
  let lastSpeed: number | null = null;
  const blob = await convertVideoForTV1080p(input.file, {
    onProgress: (percent) => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      if (durationSeconds && elapsedSeconds > 0) lastSpeed = durationSeconds / elapsedSeconds;
      onProgress?.({ percent, speed: lastSpeed ?? undefined, durationSeconds: durationSeconds ?? undefined, elapsedSeconds, outputMegabytes: estimatedMegabytes || undefined });
    },
    onLog: (message) => {
      const fps = message.match(/fps=\s*([\d.]+)/)?.[1];
      const bitrate = message.match(/bitrate=\s*([\d.]+)kbits\/s/i)?.[1];
      const time = message.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      let currentSeconds: number | undefined;
      if (time) currentSeconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      if (bitrate && currentSeconds != null) estimatedMegabytes = Number(bitrate) * 1000 * currentSeconds / 8 / (1024 * 1024);
      if (fps || currentSeconds != null || bitrate) {
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        const speed = durationSeconds && elapsedSeconds > 0 ? durationSeconds / elapsedSeconds : undefined;
        onProgress?.({ percent: currentSeconds != null && durationSeconds ? Math.min(97, Math.round(currentSeconds / durationSeconds * 100)) : 0, fps, speed, currentSeconds, durationSeconds: durationSeconds ?? undefined, elapsedSeconds, outputMegabytes: estimatedMegabytes || undefined });
      }
    },
  });
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const speed = durationSeconds && elapsedSeconds > 0 ? durationSeconds / elapsedSeconds : null;
  return { outputBytes: blob.size, elapsedSeconds, durationSeconds, speed, previewUrl: URL.createObjectURL(blob), blob, fileName: input.name.replace(/\.[^/.]*$/, "") + "_TV1080P.mp4" };
}

export function downloadWebResult(result: RuntimeResult): void {
  if (!result.blob) return;
  const anchor = document.createElement("a");
  anchor.href = result.previewUrl;
  anchor.download = result.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
