# SkateCoach AI — Guia do Projeto

## O que é este projeto

Protótipo web de análise de manobras de skate. O usuário faz upload de um vídeo de Ollie, a aplicação detecta o esqueleto do skatista quadro a quadro, extrai 5 frames-chave por eventos físicos e exibe comparação lado a lado com um vídeo de referência pré-processado. **Tudo roda no browser — zero servidor de processamento.**

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 14 App Router + TypeScript |
| Inferência de pose | YOLOv8n-Pose via `onnxruntime-web@1.20` |
| Runtime de inferência | WebGPU (Chrome 113+) → fallback WASM automático |
| Overlay | Canvas 2D API |
| Processamento | Extração de frames na thread principal (DOM) → Web Worker para inferência |
| Deploy | Vercel Hobby (free tier) |

## Como rodar

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # produção
```

**Antes do primeiro uso**: certifique-se que os assets estão em `public/` (veja seção "Antes de rodar pela primeira vez").

## Decisões de arquitetura importantes

- **"YOLO26-Pose" foi substituído** por YOLOv8n-Pose — modelo verificável, 13 MB ONNX, provado em browser. "YOLO26" não existe em nenhuma fonte verificável.
- **YOLO-World descartado** — exigiria 80-140 MB de modelo + text encoder (CLIP), inviabilizando o Vercel free tier. Board detectado por **heurística geométrica** derivada dos ankles.
- **RTMW descartado** — sem suporte browser testado. Fallback temporal usado se detecção de fases falhar.
- **Processamento em batch** (não real-time): o vídeo inteiro é processado antes de exibir resultado. Progress bar com ETA informa o usuário.
- **Extração de frames na thread principal**: `document.createElement('video')` não existe em Web Workers. A extração de frames acontece em `useVideoProcessor.ts` (thread principal). Os frames são convertidos para `ImageBitmap[]` (transferáveis, zero-copy) e enviados ao worker via `postMessage`. O worker usa `OffscreenCanvas` para converter `ImageBitmap → ImageData` internamente.
- **`onnxruntime-web` NÃO é bundled pelo webpack**. O bundle `ort.bundle.min.mjs` é copiado para `public/js/` pelo CopyPlugin e carregado no Worker via `import(/* webpackIgnore: true */ url)`. Isso evita o erro `import.meta cannot be used outside of module code` do Terser. Arquivos `.wasm` ficam em `public/wasm/`. Ambos são servidos como arquivos estáticos pelo Vercel — o Worker os acessa diretamente via HTTP.
- **`next.config.ts` não é suportado** no Next.js 14 — usar `next.config.mjs`.
- **Headers COEP/COOP obrigatórios** em `next.config.mjs` para habilitar `SharedArrayBuffer` (WASM multi-threading). Isso quebra iframes e imagens externas sem `crossorigin` — aceitável para este protótipo.
- **`ort-wasm-simd-threaded.jsep.mjs` deve estar em `public/wasm/`** — o ORT o requisita em runtime mas o CopyPlugin original não o incluía. Copiar manualmente de `node_modules/onnxruntime-web/dist/`.

## Bundle size (real)

| Asset | Tamanho | Local |
|-------|---------|-------|
| `yolov8n-pose.onnx` | 13 MB | `/public/models/` |
| `ort-wasm-simd-threaded.jsep.wasm` | 24 MB | `/public/wasm/` |
| `ort-wasm-simd-threaded.wasm` | 12 MB | `/public/wasm/` |
| `ort-wasm-simd-threaded.jsep.mjs` | 46 KB | `/public/wasm/` |
| `ort.bundle.min.mjs` | 394 KB | `/public/js/` |
| `ollie-reference.mp4` | ~3-8 MB | `/public/reference/` |
| `ollie-reference-kps.json` | ~15-50 KB | `/public/reference/` |
| App JS bundle | ~300-500 KB | Next.js auto-split |

**Atenção para deploy no Vercel**: o arquivo `ort-wasm-simd-threaded.jsep.wasm` (24 MB) está em `public/` e é servido como estático — abaixo do limite de 100 MB por arquivo.

## Arquivos críticos

```
src/workers/inference.worker.ts     ← inferência ONNX + detecção de fases (recebe ImageBitmap[])
src/hooks/useVideoProcessor.ts      ← extração de frames (DOM) + orquestra worker + estado da UI
src/lib/onnx/poseDetector.ts        ← pré/pós-processamento YOLOv8n-Pose
src/lib/onnx/sessionManager.ts      ← cria InferenceSession (WebGPU→WASM)
src/lib/phases/phaseDetector.ts     ← algoritmo das 5 fases + thresholds
src/lib/phases/phaseTypes.ts        ← thresholds ajustáveis (constantes)
src/lib/skeleton/skeletonRenderer.ts← drawSkeleton(), drawBoard() Canvas 2D
src/lib/skeleton/boardEstimator.ts  ← heurística ankle→board
src/lib/reference/referenceLoader.ts← fetch() do JSON de referência
next.config.mjs                     ← headers COEP/COOP + CopyPlugin WASM
scripts/preprocess-reference.py     ← roda LOCALMENTE, gera o JSON de referência
```

## Fases do Ollie detectadas

| Fase | Critério físico | Threshold |
|------|-----------------|-----------|
| Setup | kneeAngle < 160° por ≥3 frames | `KNEE_BEND_DEGREES = 160` |
| Pop | mínimo local de hipY + acc < -2.5 px/frame² | `ACC_POP_THRESHOLD = -2.5` |
| Flick | máx diferença entre ankles | `ANKLE_DIFF_RATIO = 0.08 × frameH` |
| Catch | mínimo de hipY (ápice) + ankles nivelados | `ANKLE_LEVEL_RATIO = 0.04 × frameH` |
| Landing | acc > +3.0 px/frame² | `ACC_LAND_THRESHOLD = 3.0` |

Para ajustar thresholds, edite `src/lib/phases/phaseTypes.ts`.

## Sistema de cores

- Esqueleto do usuário: **vermelho** (`#ef4444`)
- Esqueleto da referência: **verde** (`#22c55e`)
- Overlay do board (heurística): **amarelo** (`#eab308`)
- Fundo: frame original escurecido (opacity ~0.4 via canvas)

## Antes de rodar pela primeira vez

1. Instalar dependências:
   ```bash
   npm install
   ```

2. Gerar o modelo ONNX e colocar em `public/models/`:
   ```bash
   pip install ultralytics
   python -c "from ultralytics import YOLO; YOLO('yolov8n-pose.pt').export(format='onnx', imgsz=640, opset=12)"
   cp yolov8n-pose.onnx public/models/
   ```

3. Copiar o arquivo `.mjs` do ORT que não é incluído pelo CopyPlugin:
   ```bash
   cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs public/wasm/
   ```

4. Gerar os arquivos de referência a partir do vídeo bruto:
   ```bash
   # Colocar o vídeo de referência na raiz do projeto (ex: Flip.mp4)
   # O script já está configurado para ler PROJECT_ROOT/Flip.mp4
   pip install ultralytics opencv-python
   python scripts/preprocess-reference.py
   # Gera: public/reference/ollie-reference-kps.json
   #       public/reference/ollie-reference.mp4
   ```

5. Iniciar em desenvolvimento:
   ```bash
   npm run dev
   ```

## Deploy no Vercel

```bash
npm run build   # verifica erros de build
vercel deploy --prod
```

Checar: nenhum arquivo individual em `public/` deve ultrapassar 100 MB.

## Scopo v1

Apenas **Ollie**. Kickflip e Heelflip ficam para v2. Sem autenticação, sem banco de dados, sem histórico de sessões, sem análise por IA (Claude API).
