import { put } from "@vercel/blob";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function safeName(name: string): string {
  const original = name.trim() || "video.mp4";
  const ext = original.match(/\.[^/.]+$/)?.[0]?.toLowerCase() || ".mp4";
  const base = original.replace(/\.[^/.]*$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return `${(base || "video").slice(0, 100)}${ext}`;
}

export async function POST(request: Request) {
  try {
    const sizeBytes = Number(request.headers.get("content-length") || 0);
    const name = safeName(decodeURIComponent(request.headers.get("x-file-name") || "video.mp4"));
    const contentTypeHeader = request.headers.get("content-type") || "video/mp4";
    const contentType = contentTypeHeader.startsWith("video/") ? contentTypeHeader : "video/mp4";

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return Response.json({ error: "Não foi possível determinar o tamanho do vídeo." }, { status: 400 });
    if (sizeBytes > MAX_UPLOAD_BYTES) return Response.json({ error: "O modo Interno (Vercel) aceita vídeos de até 4 MB. Para arquivos maiores, use o processamento no aparelho." }, { status: 413 });
    if (!request.body) return Response.json({ error: "Corpo do vídeo não recebido." }, { status: 400 });

    const pathname = "video-converter/input/" + crypto.randomUUID() + "-" + name;
    const blob = await put(pathname, request.body, { access: "private", contentType, addRandomSuffix: false });
    return Response.json({ pathname: blob.pathname });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao enviar o vídeo para o Vercel Blob." }, { status: 500 });
  }
}
