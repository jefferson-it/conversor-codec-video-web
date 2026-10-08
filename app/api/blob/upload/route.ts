[Reading 27 lines from start (total: 27 lines, 0 remaining)]

"use server";

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/*"],
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ purpose: "video-conversion" }),
      }),
    });

    return Response.json(response);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao preparar o upload." },
      { status: 400 },
    );
  }
}

[executed on device: souza-rios (5724ac53-4934-454d-a273-72ca3821a2a1)]