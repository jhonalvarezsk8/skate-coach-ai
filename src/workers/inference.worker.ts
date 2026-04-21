// inference.worker.ts
// Runs entirely in a Web Worker. Handles:
//   1. Loading the MediaPipe PoseLandmarker model
//   2. Running pose inference on pre-extracted frames (ImageBitmap[])
//   3. Returning results to the main thread
//
// Frame extraction is done in the main thread (useVideoProcessor.ts) because
// document.createElement('video') is not available in Web Workers.

import type { WorkerOutMessage, PoseFrame } from "@/types";
import { mediapipeResultToPoseFrame } from "@/lib/mediapipe/poseDetector";

// ─── State ───────────────────────────────────────────────────────────────────

let cancelled = false;

// MediaPipe VIDEO mode requires strictly increasing timestamps across the entire
// lifetime of the landmarker singleton — not just within a single video.
// We keep a global counter so that each new video continues from where the last left off.
let globalLastTimestampMs = -1;

// ─── Main message handler ────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  switch (msg.type) {
    case "INIT":
      await handleInit();
      break;
    case "PROCESS_VIDEO":
      cancelled = false;
      await handleProcessVideo(
        msg.frames as ImageBitmap[],
        msg.frameTimestampsMs as number[],
        msg.frameWidth as number,
        msg.frameHeight as number,
        msg.durationMs as number,
      );
      break;
    case "CANCEL":
      cancelled = true;
      break;
  }
};

// ─── Init: load model ────────────────────────────────────────────────────────

async function handleInit(): Promise<void> {
  try {
    const { getOrCreatePoseSession } = await import("@/lib/mediapipe/poseSession");
    const { info } = await getOrCreatePoseSession();

    postMessage({ type: "READY", provider: info.provider } satisfies WorkerOutMessage);
  } catch (err) {
    postMessage({
      type: "ERROR",
      code: "MODEL_LOAD_FAILED",
      message: "Não foi possível carregar o modelo de AI. Verifique sua conexão.",
    } satisfies WorkerOutMessage);
  }
}

// ─── Process: infer on frames → return ───────────────────────────────────────

async function handleProcessVideo(
  frames: ImageBitmap[],
  frameTimestampsMs: number[],
  frameWidth: number,
  frameHeight: number,
  durationMs: number,
): Promise<void> {
  try {
    const { getOrCreatePoseSession } = await import("@/lib/mediapipe/poseSession");
    const { landmarker } = await getOrCreatePoseSession();

    if (frames.length === 0) {
      postMessage({
        type: "ERROR",
        code: "VIDEO_READ_ERROR",
        message: "Não foi possível extrair frames do vídeo.",
      } satisfies WorkerOutMessage);
      return;
    }

    // OffscreenCanvas to convert ImageBitmap → ImageData inside the worker
    const canvas = new OffscreenCanvas(frameWidth, frameHeight);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

    // Force the PoseLandmarker tracker to reset between videos.
    // VIDEO mode tracks poses temporally — without a gap, the model "continues"
    // tracking from the previous video. A 5s jump exceeds the tracker's window
    // (~500ms), triggering a fresh detection for the first frame.
    globalLastTimestampMs += 5000;

    // ── Run inference on each frame (VIDEO mode — temporal tracking) ───────
    const poseFrames: PoseFrame[] = [];
    const startTime = Date.now();

    for (let i = 0; i < frames.length; i++) {
      if (cancelled) return;

      const bitmap = frames[i];
      ctx.drawImage(bitmap, 0, 0, frameWidth, frameHeight);
      const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);

      const rawTs = frameTimestampsMs[i] ?? Math.round((i / frames.length) * durationMs);
      // MediaPipe VIDEO mode requires strictly increasing timestamps across the
      // entire landmarker lifetime (singleton). Advance the global counter so
      // a second video never re-uses a timestamp the model has already seen.
      const timestampMs = Math.max(globalLastTimestampMs + 1, rawTs);
      globalLastTimestampMs = timestampMs;

      const result = landmarker.detectForVideo(imageData, timestampMs);
      const poseFrame = mediapipeResultToPoseFrame(result, i, rawTs, frameWidth, frameHeight);
      poseFrames.push(poseFrame);

      // Report progress every 5 frames
      if (i % 5 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        const remaining = (frames.length - i - 1) / rate;
        postMessage({
          type: "PROGRESS",
          stage: "inferring",
          current: i + 1,
          total: frames.length,
          etaSeconds: Math.round(remaining),
        } satisfies WorkerOutMessage);
      }
    }

    if (cancelled) return;

    // Check that at least one person was detected
    const detectedCount = poseFrames.filter((f) => f.detectionConf > 0.3).length;
    if (detectedCount < frames.length * 0.1) {
      postMessage({
        type: "ERROR",
        code: "NO_PERSON_DETECTED",
        message:
          "Nenhum skatista detectado no vídeo. Certifique-se que o skatista está visível e bem iluminado.",
      } satisfies WorkerOutMessage);
      return;
    }

    // ── Return result ───────────────────────────────────────────────────────
    postMessage({
      type: "RESULT",
      poseFrames,
    } satisfies WorkerOutMessage);
  } catch (err) {
    postMessage({
      type: "ERROR",
      code: "WORKER_CRASHED",
      message: "Erro interno no processamento. Recarregue a página.",
    } satisfies WorkerOutMessage);
  }
}
