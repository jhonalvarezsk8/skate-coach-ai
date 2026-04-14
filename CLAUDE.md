# SkateCoach AI — Guia do Projeto

## O que é este projeto

Protótipo web de análise de manobras de skate. O usuário faz upload de um vídeo de Ollie, a aplicação detecta o esqueleto do skatista quadro a quadro (33 keypoints BlazePose), extrai 5 frames-chave por eventos físicos e exibe comparação lado a lado com um vídeo de referência pré-processado. **Tudo roda no browser — zero servidor de processamento.**

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 14 App Router + TypeScript |
| Inferência de pose | MediaPipe PoseLandmarker Lite (`@mediapipe/tasks-vision`) — 33 keypoints BlazePose |
| Runtime de inferência | GPU delegate → fallback CPU automático |
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

- **MediaPipe PoseLandmarker** substitui YOLOv8n-Pose/ONNX — 33 keypoints BlazePose, mais preciso para vídeos verticais, ~5 MB de modelo.
- **YOLO-World descartado** — exigiria 80-140 MB de modelo + text encoder (CLIP), inviabilizando o Vercel free tier. Board detectado por **heurística geométrica** derivada dos ankles (índices 27/28 BlazePose).
- **Processamento em batch** (não real-time): o vídeo inteiro é processado antes de exibir resultado. Progress bar com ETA informa o usuário.
- **Extração de frames na thread principal**: `document.createElement('video')` não existe em Web Workers. A extração acontece em `useVideoProcessor.ts` (thread principal). Os frames são convertidos para `ImageBitmap[]` (transferáveis, zero-copy) e enviados ao worker via `postMessage`. O worker usa `OffscreenCanvas` para converter `ImageBitmap → ImageData` internamente.
- **Todos os frames pré-extraídos como `ImageData[]`**: durante a extração, cada frame é capturado como `ImageData` (640×640) e armazenado em `ProcessingResult.allFrameImages`. O scrubber usa esses arrays diretamente — zero seeks, zero decode, fluência máxima.
- **Frames de referência pré-extraídos em `ComparisonView`**: o vídeo de referência (`/reference/ollie-reference.mp4`) é um asset estático. Ao montar o componente, um useEffect extrai todos os frames via seek loop e os armazena em `refFrameImagesRef`. Enquanto carrega, o canvas mostra "Carregando referência…".
- **Suavização temporal de poses** (`src/lib/skeleton/poseSmoothing.ts`): média ponderada por visibilidade sobre uma janela de frames vizinhos. Elimina glitches de detecção em frames isolados. Janela = 3 para o vídeo do usuário (WASM processa frames 640×640 esticados, mais ruído); janela = 2 para a referência (Python SDK processou em resolução nativa, mais preciso).
- **`MediaPipe` NÃO é bundled pelo webpack**. O bundle `mediapipe-vision.mjs` é copiado para `public/js/` pelo CopyPlugin e carregado no Worker via `import(/* webpackIgnore: true */ url)`. Arquivos `.wasm` ficam em `public/wasm/mediapipe/`. O Worker os acessa diretamente via HTTP.
- **PoseLandmarker é singleton no worker** — criado uma vez em `poseSession.ts` e reutilizado. Em modo VIDEO, exige timestamps **estritamente crescentes ao longo de toda a sessão** (não apenas dentro de um vídeo). Por isso `globalLastTimestampMs` é variável de módulo. **Atenção**: o timestamp passado ao MediaPipe é diferente do timestamp armazenado no `PoseFrame` — o `PoseFrame` armazena o `rawTs` relativo ao vídeo (0..durationMs) para que o scrubber funcione corretamente.
- **`next.config.ts` não é suportado** no Next.js 14 — usar `next.config.mjs`.
- **Headers COEP/COOP obrigatórios** em `next.config.mjs` para habilitar `SharedArrayBuffer` (WASM multi-threading). Isso quebra iframes e imagens externas sem `crossorigin` — aceitável para este protótipo.

## Bundle size (real)

| Asset | Tamanho | Local |
|-------|---------|-------|
| `pose_landmarker_lite.task` | ~5 MB | `/public/models/` |
| `mediapipe-vision.mjs` | ~400 KB | `/public/js/` |
| `vision_wasm_internal.wasm` | ~3 MB | `/public/wasm/mediapipe/` |
| `ollie-reference.mp4` | ~3-8 MB | `/public/reference/` |
| `ollie-reference-kps.json` | ~15-50 KB | `/public/reference/` |
| App JS bundle | ~300-500 KB | Next.js auto-split |

## Arquivos críticos

```
src/workers/inference.worker.ts       ← inferência MediaPipe + detecção de fases (recebe ImageBitmap[])
src/hooks/useVideoProcessor.ts        ← extração de frames + pré-captura de ImageData[] + orquestra worker
src/lib/mediapipe/poseSession.ts      ← singleton PoseLandmarker (carrega modelo, GPU→CPU fallback)
src/lib/mediapipe/poseDetector.ts     ← PoseLandmarkerResult → PoseFrame (denormaliza coords)
src/lib/mediapipe/keypointMap.ts      ← índices BlazePose 33 + BLAZEPOSE_SKELETON_CONNECTIONS
src/lib/skeleton/poseSmoothing.ts     ← suavização temporal (média ponderada por visibilidade)
src/lib/skeleton/skeletonRenderer.ts  ← drawSkeleton(), drawBoard() Canvas 2D
src/lib/skeleton/boardEstimator.ts    ← heurística ankle→board (índices 27/28 BlazePose)
src/lib/phases/phaseDetector.ts       ← algoritmo das 5 fases + thresholds
src/lib/phases/phaseTypes.ts          ← thresholds ajustáveis (constantes)
src/lib/reference/referenceLoader.ts  ← fetch() do JSON + suavização da referência
src/components/ComparisonView.tsx     ← scrubber frame-a-frame + pré-extração de frames de referência
next.config.mjs                       ← headers COEP/COOP + CopyPlugin MediaPipe WASM
scripts/preprocess-reference.py       ← roda LOCALMENTE com MediaPipe Python SDK, gera o JSON
```

## Keypoints BlazePose (índices relevantes)

| Índice | Anatomia |
|--------|----------|
| 11, 12 | left_shoulder, right_shoulder |
| 23, 24 | left_hip, right_hip |
| 25, 26 | left_knee, right_knee |
| 27, 28 | left_ankle, right_ankle |

## Fases do Ollie detectadas

| Fase | Critério físico | Threshold |
|------|-----------------|-----------|
| Setup | kneeAngle < 160° por ≥3 frames | `KNEE_BEND_DEGREES = 160` |
| Pop | mínimo local de hipY + acc < -2.5 px/frame² | `ACC_POP_THRESHOLD = -2.5` |
| Flick | máx diferença entre ankles (27/28) | `ANKLE_DIFF_RATIO = 0.08 × frameH` |
| Catch | mínimo de hipY (ápice) + ankles nivelados | `ANKLE_LEVEL_RATIO = 0.04 × frameH` |
| Landing | acc > +3.0 px/frame² | `ACC_LAND_THRESHOLD = 3.0` |

Para ajustar thresholds, edite `src/lib/phases/phaseTypes.ts`.

## Sistema de cores

- Esqueleto do usuário: **vermelho** (`#ef4444`)
- Esqueleto da referência: **verde** (`#22c55e`)
- Overlay do board (heurística): **amarelo** (`#eab308`)
- Fundo: frame original escurecido (overlay `rgba(0,0,0,0.35)` via canvas)

## Antes de rodar pela primeira vez

1. Instalar dependências:
   ```bash
   npm install
   ```

2. Copiar os assets do MediaPipe para `public/` (feito automaticamente pelo CopyPlugin no `next dev`/`next build`):
   ```bash
   npm run dev   # CopyPlugin copia mediapipe-vision.mjs → public/js/ e wasm → public/wasm/mediapipe/
   ```

3. Gerar os arquivos de referência a partir do vídeo bruto:
   ```bash
   # Colocar o vídeo de referência na raiz do projeto (ex: Flip.mp4)
   pip install mediapipe opencv-python
   python scripts/preprocess-reference.py
   # Gera: public/reference/ollie-reference-kps.json
   #       public/reference/ollie-reference.mp4
   ```
   O modelo `pose_landmarker_lite.task` já está em `public/models/` (commitado no repo).

4. Iniciar em desenvolvimento:
   ```bash
   npm run dev
   ```

## Deploy no Vercel

```bash
npm run build   # verifica erros de build
vercel deploy --prod
```

Checar: nenhum arquivo individual em `public/` deve ultrapassar 100 MB.

## Repositório GitHub

`https://github.com/jhonalvarezsk8/skate-coach-ai` — conta `jhonalvarezsk8`.

Para commitar e sincronizar:
```bash
git add <arquivos>
git commit -m "..."
git push
```

Se o push falhar com 403 (credenciais erradas), atualizar a URL do remote:
```bash
git remote set-url origin https://jhonalvarezsk8@github.com/jhonalvarezsk8/skate-coach-ai.git
```

## Scopo v1

Apenas **Ollie**. Kickflip e Heelflip ficam para v2. Sem autenticação, sem banco de dados, sem histórico de sessões, sem análise por IA (Claude API).
