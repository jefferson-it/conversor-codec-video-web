import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A Vercel serve apenas arquivos estáticos + SSR da página.
  // Todo o processamento de vídeo acontece no navegador (FFmpeg.wasm).
  //
  // Isolamento cross-origin (COOP + COEP): habilita SharedArrayBuffer, que
  // permite usar o core MULTI-THREAD (@ffmpeg/core-mt, ~3-4x mais rápido).
  // Funciona no `next dev`, `next start` e na Vercel (headers saem do próprio
  // Next, sem config no painel). Navegadores sem suporte apenas ignoram os
  // headers e o app cai automaticamente para o core single-thread.
  // NOTA: o build/dev rodam com `--webpack` (ver package.json) porque o
  // Turbopack não resolve o `new Worker(new URL(...))` dinâmico do
  // @ffmpeg/ffmpeg — o webpack trata esse padrão corretamente.
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/convert": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
