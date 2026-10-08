
"use client";

import { upload } from "@vercel/blob/client";
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

export async function convertInput(
  input: RuntimeInput,
  onProgress?: (p: RuntimeProgress) => void,
): Promise<RuntimeResult> {
  if (!input.file) throw new Error("Arquivo de entrada não disponível.");

  const durationSeconds = await getVideoDuration(input.file);
  const startedAt = performance.now();
  let estimatedMegabytes = 0;
  let lastSpeed: number | null = null;

  const blob = await convertVideoForTV1080p(input.file, {
    onProgress: (percent) => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      if (durationSeconds && elapsedSeconds > 0) lastSpeed = durationSeconds / elapsedSeconds;
      onProgress?.({
        percent,
        speed: lastSpeed ?? undefined,
        durationSeconds: durationSeconds ?? undefined,
        elapsedSeconds,
        outputMegabytes: estimatedMegabytes || undefined,
      });
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
        onProgress?.({
          percent: currentSeconds != null && durationSeconds ? Math.min(97, Math.round(currentSeconds / durationSeconds * 100)) : 0,
          fps,
          speed,
          currentSeconds,
          durationSeconds: durationSeconds ?? undefined,
          elapsedSeconds,
          outputMegabytes: estimatedMegabytes || undefined,
        });
      }
    },
  });

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const speed = durationSeconds && elapsedSeconds > 0 ? durationSeconds / elapsedSeconds : null;

  return {
    outputBytes: blob.size,
    elapsedSeconds,
    durationSeconds,
    speed,
    previewUrl: URL.createObjectURL(blob),
    blob,
    fileName: input.name.replace(/\.[^/.]*$/, "") + "_TV1080P.mp4",
  };
}

export async function convertInputInternal(
  input: RuntimeInput,
  onProgress?: (p: RuntimeProgress) => void,
): Promise<RuntimeResult> {
  if (!input.file) throw new Error("Arquivo de entrada não disponível.");

  const durationSeconds = await getVideoDuration(input.file);
  const startedAt = performance.now();

  onProgress?.({ percent: 2, durationSeconds: durationSeconds ?? undefined, elapsedSeconds: 0 });

  const uploaded = await upload(
    `video-converter/input/${Date.now()}-${input.name}`,
    input.file,
    {
      access: "private",
      handleUploadUrl: "/api/blob/upload",
      multipart: true,
      onUploadProgress(event) {
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        onProgress?.({
          percent: Math.min(10, Math.max(2, Math.round(event.percentage / 10))),
          durationSeconds: durationSeconds ?? undefined,
          elapsedSeconds,
        });
      },
    },
  );

  onProgress?.({ percent: 10, durationSeconds: durationSeconds ?? undefined });

  const response = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pathname: uploaded.pathname,
      name: input.name,
      durationSeconds,
    }),
  });

  if (!response.ok || !response.body) {
    let message = "A conversão interna falhou.";
    try {
      const data = await response.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      /* resposta não-JSON */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: RuntimeResult | null = null;

  const consume = (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line) as {
        type: "progress" | "done";
        percent?: number;
        currentSeconds?: number;
        fps?: string;
        outputBytes?: number;
        fileName?: string;
        previewUrl?: string;
      };

      if (data.type === "progress") {
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        onProgress?.({
          percent: data.percent ?? 10,
          fps: data.fps,
          currentSeconds: data.currentSeconds,
          durationSeconds: durationSeconds ?? undefined,
          elapsedSeconds,
        });
      } else if (data.type === "done") {
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        const speed = durationSeconds && elapsedSeconds > 0 ? durationSeconds / elapsedSeconds : null;
        result = {
          outputBytes: data.outputBytes ?? 0,
          elapsedSeconds,
          durationSeconds,
          speed,
          previewUrl: data.previewUrl ?? "",
          fileName: data.fileName ?? input.name.replace(/\.[^/.]*$/, "") + "_TV1080P.mp4",
        };
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());

  const completed = result as RuntimeResult | null;
  if (!completed) throw new Error("O servidor terminou sem entregar o MP4.");

  onProgress?.({
    percent: 100,
    durationSeconds: completed.durationSeconds ?? undefined,
    elapsedSeconds: completed.elapsedSeconds,
    outputMegabytes: completed.outputBytes / (1024 * 1024),
  });

  return completed;
}

export function downloadWebResult(result: RuntimeResult): void {
  if (!result.previewUrl) return;
  const anchor = document.createElement("a");
  anchor.href = result.previewUrl;
  anchor.download = result.fileName;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

