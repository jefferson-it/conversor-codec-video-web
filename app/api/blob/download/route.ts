import { get } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const pathname = new URL(request.url).searchParams.get("pathname")?.trim();
    if (!pathname || !pathname.startsWith("video-converter/output/")) {
      return new Response("Arquivo inválido.", { status: 400 });
    }

    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new Response("Arquivo não encontrado.", { status: 404 });
    }

    const filename = result.blob.pathname.split("/").pop() || "video.mp4";
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao baixar o vídeo." },
      { status: 500 },
    );
  }
}
