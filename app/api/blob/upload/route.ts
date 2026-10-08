import { issueSignedToken, presignUrl } from "@vercel/blob";

export const runtime = "nodejs";

type RequestBody = {
  name?: string;
  contentType?: string;
  sizeBytes?: number;
};

function safeName(name: string): string {
  const original = name.trim() || "video.mp4";
  const ext = original.match(/\.[^/.]+$/)?.[0]?.toLowerCase() || ".mp4";
  const base = original
    .replace(/\.[^/.]*$/, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim();

  return `${(base || "video").slice(0, 100)}${ext}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const name = safeName(body.name || "video.mp4");
    const contentType = body.contentType?.startsWith("video/")
      ? body.contentType
      : "video/mp4";
    const sizeBytes = Number(body.sizeBytes);

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 500 * 1024 * 1024) {
      return Response.json(
        { error: "O vídeo deve ter entre 1 byte e 500 MB." },
        { status: 400 },
      );
    }

    const pathname = `video-converter/input/${crypto.randomUUID()}-${name}`;
    const validUntil = Date.now() + 15 * 60 * 1000;

    const token = await issueSignedToken({
      pathname,
      operations: ["put"],
      allowedContentTypes: [contentType],
      maximumSizeInBytes: 500 * 1024 * 1024,
      validUntil,
    });

    const { presignedUrl } = await presignUrl(token, {
      pathname,
      operation: "put",
      validUntil,
    });

    return Response.json({ pathname, presignedUrl });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao preparar o upload direto para o Vercel Blob.",
      },
      { status: 500 },
    );
  }
}
