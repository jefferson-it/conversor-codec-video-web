import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conversor de Vídeo TV 1080p — Para TV 1080p P40VIK Roku",
  description:
    "Converta seus vídeos direto no navegador para reproduzir na TV 1080p P40VIK 40\" Roku Full HD (girada 90° para vídeos verticais). 100% local e privado: nada é enviado para servidores.",
  applicationName: "Conversor de Vídeo TV 1080p",
  keywords: ["conversor de vídeo", "tv1080p", "roku", "p40vik", "mp4", "ffmpeg"],
  authors: [{ name: "Conversor de Vídeo TV 1080p" }],
  icons: {
    icon: "/favicon.svg",
  },
  // Faz o site se comportar como app ao usar "Adicionar à Tela de Início"
  // no iPhone/iPad (iPhone 12, 16 Pro etc.): abre em tela cheia, sem barra
  // do Safari, com nome e tema próprios.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Conversor TV 1080p",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Conversor de Vídeo TV 1080p",
    description:
      "Converta vídeos no próprio dispositivo para assistir na TV 1080p P40VIK Roku. Rápido, privado e sem enviar nada para servidores.",
    type: "website",
    locale: "pt_BR",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      {/*
        suppressHydrationWarning: extensões de navegador (ex.: ColorZilla,
        que injeta `cz-shortcut-listen="true"`) alteram o <body> antes da
        hidratação e causariam hydration mismatch. O aviso é suprimido só
        aqui na raiz; o restante da árvore continua verificado normalmente.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
