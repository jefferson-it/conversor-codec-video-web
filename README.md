# Conversor de Vídeo TV 1080p

Aplicação web (Next.js + React + TypeScript) que converte vídeos **100% no navegador**
com FFmpeg WebAssembly para reprodução na **TV TV 1080p P40VIK 40" Roku Full HD**
(usada fisicamente girada 90° para vídeos verticais).

- Nenhum upload: o vídeo nunca sai do dispositivo.
- Sem API Route de processamento, sem banco, sem analytics.
- Deploy estático na Vercel.

## Conversão (configuração definitiva — não alterar)

```bash
ffmpeg -i "entrada" \
-vf "transpose=1,scale=1920:1080" \
-c:v libx264 -profile:v high -level:v 4.0 \
-pix_fmt yuv420p \
-x264-params "ref=1:bframes=2" \
-r 30 -crf 18 \
-c:a aac -b:a 192k -ar 48000 -ac 2 \
-movflags +faststart \
"NOME_ORIGINAL_TV1080P.mp4"
```

Ex.: `anuncio.mp4 → anuncio_TV1080P.mp4`. Reproduzida fielmente em
`lib/ffmpeg.ts` (FFmpeg.wasm). Nenhum filtro, sharpening, denoise ou
pós-processamento além do comando acima.

## Como rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000.

## Build / produção

```bash
npm run build
npm start
```

O `npm run build` copia automaticamente para `public/ffmpeg/`:
`ffmpeg-core.js` + `ffmpeg-core.wasm` (ESM single-thread),
`ffmpeg-core.classic.js` (variante importScripts-compatível, gerada com patch
a partir do UMD), o class worker (`worker.js` + `const.js` + `errors.js` do
`@ffmpeg/ffmpeg`) e `mt/` (core multi-thread: `.js` + `.wasm` + `.worker.js`).
O worker estático é apontado via `classWorkerURL` — ESSENCIAL: sem ele, o
webpack (dev e build) empacota o worker interno da lib e sequestra o
`await import(coreURL)` dinâmico, trocando-o por um `require` de contexto
que falha para qualquer URL absoluta ("Cannot find module 'http://...'").
Com o worker servido como arquivo estático, o `import()` é nativo.
O carregamento tenta, nesta ordem (quando a página está isolada
cross-origin, o MT vem primeiro): MT local → ESM local → classic local
(arquivo) → ESM via unpkg → classic gerado em runtime a partir do ESM
(local e CDN), com pré-checagem que gera erro legível. Tudo na própria
origem. Se algum 404 em `/ffmpeg/` aparecer, rode `npm run copy:ffmpeg`
para regenerar os arquivos.

## Desempenho (leitura honesta)

Referência medida na máquina de desenvolvimento (10 núcleos):

```text
ffmpeg nativo, mesmos parâmetros: ~5:52 min (1004% CPU)
```

Ou seja, o trabalho é pesado por natureza (x264 CRF 18 em 1080p30). No
navegador:
- **Multi-thread** (página isolada via COOP/COEP — padrão neste projeto):
  ~3-4x mais rápido que single-thread no desktop. Espere algo como
  15-25 min para um vídeo de 5 min, dependendo da máquina.
- **Single-thread** (fallback, ex. iOS antigo): ~10x mais lento que o nativo
  multi-core — um vídeo de 5 min pode passar de 1h. É o preço de rodar 100%
  local sem servidor.
- A barra de progresso é monotônica (nunca anda para trás) e mostra tempo
  decorrido + estimativa restante. Não feche a aba durante a conversão.
- Se o motor ficar mais de 8 min sem emitir nenhum sinal, a tela oferece
  **Cancelar conversão**. Abaixo da barra há o motor em uso
  ("Motor: multi-thread · N núcleos") e um recolhível **Detalhes técnicos**
  com o log do FFmpeg.
- `?motor=st` no endereço força o modo single-thread (útil se o MT travar).
- Teste de fumaça: todo motor carregado roda `ffmpeg -version` (45s de
  tolerância) antes de ser aceito. Se o MT travar no exec, é descartado
  automaticamente e o próximo da fila (single-thread) assume — o Detalhe
  mostra o motivo ("exec não responde").
  Se travar no começo com arquivo gigante, teste primeiro com um vídeo curto:
  o limite prático é a memória RAM da aba do navegador.

> O build/dev usam `--webpack` (ver `package.json`) porque o Turbopack não
> resolve o `new Worker(new URL(...))` dinâmico do `@ffmpeg/ffmpeg`.

## iPhone / iPad (iPhone 12, 16 Pro e afins)

Não existe versão separada: é o mesmo site, que já foi desenhado mobile-first
estilo app iOS (safe-areas, botões grandes, Dark Mode, Compartilhar nativo).
Dá para usar "Adicionar à Tela de Início" no Safari (abre em tela cheia).
Porém, honestidade técnica:
- iPhones têm pouca RAM para a aba do navegador. **No celular, converta vídeos
  curtos** (até ~1-2 min). Vídeos de 5 min em 4K podem estourar a memória do
  iPhone 12 (4 GB) e até do 16 Pro.
- **Vídeos longos: use o computador** (desktop tem RAM e multi-thread).
- O iOS usa o botão **Compartilhar** após converter (Salvar em Arquivos).
- A entrada do vídeo usa WORKERFS (leitura sob demanda, sem copiar o arquivo
  inteiro para a memória) com fallback automático para o modo clássico.

## Velocidade máxima (sem tocar nos parâmetros)

Os parâmetros de codificação são congelados, então a velocidade vem de:
- **Multi-thread**: com a página isolada (headers COOP/COEP — **reinicie o
  `npm run dev` após atualizar o código**, headers só valem após restart),
  o app usa todos os núcleos. Confirme em Detalhes técnicos:
  "Página isolada: sim" + "Motor: multi-thread · N núcleos".
- **Sem throttle**: Wake Lock mantém a tela acesa durante a conversão
  (iPhone/notebook). Não minimize a aba por muito tempo.
- **Fonte leve**: o gargalo nº 1 é decodificar o original. iPhone em 4K60
  gera ~4x mais pixels para decodificar que 1080p30 — e a saída é 1080p30 de
  todo jeito. Dica: Ajustes do iPhone → Câmera → gravar em **1080p30**
  acelera muito a conversão com resultado final idêntico na TV.
- **Memória**: entrada via WORKERFS (sem cópias) + limpeza após converter.
  Arquivos > 1,5 GB geram aviso; o limite prático é a RAM da aba.
- **Ritmo visível**: a tela mostra fps atual + ETA. Números realistas no
  desktop de 10 núcleos: nativo 5:52 min → navegador MT ~15-25 min para
  5 min de vídeo; ST passa de 1h. No celular, só vídeos curtos.

## Deploy na Vercel

Basta conectar o repositório — nenhum ajuste de servidor é necessário.
Todo o processamento acontece no cliente.

## Estrutura

- `app/layout.tsx` — metadata (title, description, viewport), favicon
- `app/page.tsx` — fluxo seleção → conversão → download (`'use client'`)
- `app/globals.css` — visual premium mobile-first inspirado no iOS + Dark Mode
- `components/` — `VideoUploader`, `VideoPreview`, `ConversionProgress`, `DownloadResult`
- `lib/ffmpeg.ts` — singleton FFmpeg.wasm + `convertVideoForTV 1080p`
- `lib/format.ts` — validação e formatação pt-BR
- `scripts/copy-ffmpeg-core.mjs` — copia o core para `public/ffmpeg`
