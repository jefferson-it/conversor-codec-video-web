
import { issueSignedToken, presignUrl, put, del } from "@vercel/blob";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = {
  pathname?: string;
  name?: string;
  durationSeconds?: number | null;
};

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

function safeName(name: string): string {
  const base = name.replace(/\.[^/.]*$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return (base || "video").slice(0, 100);
}

function runFfmpeg(
  args: string[],
  durationSeconds: number | null,
  send: (value: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("FFmpeg nativo não está disponível nesta implantação."));
      return;
    }

    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      let currentSeconds: number | null = null;
      let fps: string | null = null;

      for (const line of lines) {
        const [key, value] = line.split("=", 2);
        if (key === "out_time_ms") {
          const raw = Number(value);
          if (Number.isFinite(raw)) currentSeconds = raw / 1_000_000;
        } else if (key === "fps") {
          fps = value;
        }
      }

      if (currentSeconds != null) {
        const percent = durationSeconds && durationSeconds > 0
          ? Math.min(98, Math.max(5, Math.round(currentSeconds / durationSeconds * 88) + 10))
          : 50;
        send({ type: "progress", percent, currentSeconds, fps });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        send({ type: "progress", percent: 98 });
        resolve();
      } else {
        reject(new Error(stderr.match(/Error while .*|Invalid .*|Unknown .*|No such file.*/i)?.[0] ?? `FFmpeg encerrou com código ${code ?? "desconhecido"}.`));
      }
    });
  });
}

export async function POST(request: Request) {
  let tempDir = "";

  try {
    const body = (await request.json()) as RequestBody;
    const pathname = body.pathname?.trim();
    const originalName = body.name?.trim() || "video.mp4";
    const durationSeconds =
      typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
        ? body.durationSeconds
        : null;

    if (!pathname || !pathname.startsWith("video-converter/")) {
      return Response.json({ error: "Arquivo de entrada inválido." }, { status: 400 });
    }

    // O navegador fez o upload por uma URL PUT assinada. Para ler um Blob
    // privado de forma determinística, gere aqui uma URL GET assinada e baixe
    // o objeto diretamente do storage. Isso evita depender de uma consulta
    // autenticada ao índice do Blob logo após o upload.
    let sourceResponse: Response | null = null;

    for (let attempt = 0; attempt < 6 && !sourceResponse; attempt += 1) {
      const token = await issueSignedToken({
        pathname,
        operations: ["get"],
        validUntil: Date.now() + 5 * 60 * 1000,
      });
      const { presignedUrl } = await presignUrl(token, {
        pathname,
        operation: "get",
        access: "private",
        validUntil: Date.now() + 5 * 60 * 1000,
      });

      const candidate = await fetch(presignedUrl, {
        cache: "no-store",
      });

      if (candidate.ok) {
        sourceResponse = candidate;
      } else if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!sourceResponse?.body) {
      return Response.json(
        { error: "Vídeo enviado não foi encontrado no armazenamento após aguardar a sincronização." },
        { status: 404 },
      );
    }

    tempDir = join(tmpdir(), `video-converter-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    const inputPath = join(tempDir, "entrada" + (originalName.match(/\.[^/.]+$/)?.[0] || ".mp4"));
    const outputPath = join(tempDir, "saida_TV1080P.mp4");

    await pipeline(
      Readable.fromWeb(sourceResponse.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(inputPath),
    );

    const outputName = `${safeName(originalName)}_TV1080P.mp4`;
    const sendBuffer = new TransformStream();
    const writer = sendBuffer.writable.getWriter();

    const send = (value: unknown) => {
      void writer.write(new TextEncoder().encode(jsonLine(value)));
    };

    const responsePromise = Promise.resolve(
      new Response(sendBuffer.readable, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );

    send({ type: "progress", percent: 4 });

    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", inputPath,
        "-vf", "transpose=1,scale=1920:1080",
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level:v", "4.0",
        "-pix_fmt", "yuv420p",
        "-x264-params", "ref=1:bframes=2",
        "-r", "30",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        "-nostats",
        outputPath,
      ],
      durationSeconds,
      send,
    );

    const outputInfo = await stat(outputPath);
    const outputBlob = await put(`video-converter/output/${randomUUID()}-${outputName}`, createReadStream(outputPath), {
      access: "private",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });

    const token = await issueSignedToken({
      pathname: outputBlob.pathname,
      operations: ["get"],
    });
    const signed = await presignUrl(token, {
      pathname: outputBlob.pathname,
      operation: "get",
      access: "private",
      validUntil: Date.now() + 30 * 60 * 1000,
    });

    send({
      type: "done",
      percent: 100,
      outputBytes: outputInfo.size,
      fileName: outputName,
      previewUrl: signed.presignedUrl,
    });
    await writer.close();

    await del(pathname).catch(() => undefined);

    return await responsePromise;
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : "Falha na conversão interna.";
      return Response.json({ error: message }, { status: 500 });
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

