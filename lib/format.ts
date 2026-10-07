/** Utilidades de formatação e validação (pt-BR). */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted =
    value >= 100 ? Math.round(value).toString() : value.toFixed(value >= 10 ? 1 : 0);
  return `${formatted.replace(".", ",")} ${units[unit]}`;
}

const VIDEO_EXTENSIONS = [
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "3gp",
  "3g2",
  "ogv",
  "mts",
  "m2ts",
  "wmv",
  "flv",
];

export function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) return "";
  return parts.pop() ?? "";
}

/** Aceita `video/*` ou extensões de vídeo conhecidas (iPhone às vezes manda type vazio). */
export function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = getExtension(file.name);
  if (ext && VIDEO_EXTENSIONS.includes(ext)) return true;
  // Alguns celulares enviam video/quicktime etc. — o prefixo acima já cobre.
  // Como último recurso, aceitamos application/mp4 e application/octet-stream com extensão de vídeo.
  if (ext === "mp4" || ext === "m4v") return true;
  return false;
}

export function validateVideoFile(file: File): string | null {
  if (!file) return "Nenhum arquivo foi selecionado. Tente novamente.";
  if (file.size === 0)
    return "Esse arquivo parece estar vazio (0 bytes). Escolha outro vídeo.";
  if (!looksLikeVideo(file))
    return "Esse arquivo não parece ser um vídeo. Escolha um arquivo de vídeo (por exemplo, .mp4 ou .mov).";
  return null;
}

export function isBrowserSupported(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false, reason: "SSR" };
  if (typeof WebAssembly === "undefined")
    return {
      ok: false,
      reason: "Seu navegador não suporta WebAssembly, necessário para converter o vídeo.",
    };
  if (typeof Worker === "undefined")
    return {
      ok: false,
      reason: "Seu navegador não suporta Web Workers, necessários para a conversão.",
    };
  if (
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    return {
      ok: false,
      reason: "Seu navegador não suporta recursos básicos para baixar o vídeo convertido.",
    };
  // crossOriginIsolated NÃO é exigido (usamos core single-thread de propósito).
  return { ok: true };
}
