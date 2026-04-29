"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppState,
  PhaseMap,
  PoseFrame,
  PhaseName,
  WorkerOutMessage,
} from "@/types";
import { smoothPoseFrames } from "@/lib/skeleton/poseSmoothing";

export interface ProcessingResult {
  poseFrames: PoseFrame[];
  phases: PhaseMap;
  keyFrameImages: Record<PhaseName, ImageData>;
  allFrameImages: ImageData[];             // all decoded frames for instant scrubbing
  videoUrl: string;                        // createObjectURL — valid until reset()
  videoAspect: { w: number; h: number };   // original video dimensions for canvas sizing
}

export interface UseVideoProcessorReturn {
  state: AppState;
  workerProvider: string | null;
  result: ProcessingResult | null;
  processVideo: (file: File) => void;
  cancel: () => void;
  reset: () => void;
}

const INITIAL_STATE: AppState = {
  status: "loading_model",
  progress: 0,
  statusMessage: "Carregando modelo de IA…",
  etaSeconds: null,
  errorCode: null,
  errorMessage: null,
};

const ERROR_MESSAGES: Record<string, string> = {
  MODEL_LOAD_FAILED:
    "Não foi possível carregar o modelo de AI. Verifique sua conexão e recarregue a página.",
  VIDEO_READ_ERROR:
    "Não foi possível ler o vídeo. Tente outro arquivo.",
  NO_PERSON_DETECTED:
    "Nenhum skatista detectado. Certifique-se que o skatista está visível no vídeo inteiro.",
  PHASE_DETECTION_FAILED:
    "Não foi possível identificar as fases do Ollie. O alinhamento automático foi usado.",
  WORKER_CRASHED:
    "Erro interno no processamento. Recarregue a página.",
  INVALID_FORMAT:
    "Formato não suportado. Use MP4, WebM ou MOV.",
  VIDEO_TOO_LONG:
    "Vídeo muito longo. Use um vídeo de até 30 segundos.",
  VIDEO_TOO_SHORT:
    "Vídeo muito curto. Grave pelo menos 1 segundo.",
  FILE_TOO_LARGE:
    "Arquivo muito grande. Máximo 200 MB.",
};

export function useVideoProcessor(): UseVideoProcessorReturn {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [workerProvider, setWorkerProvider] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  // ── Boot worker on mount ──────────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/inference.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      handleWorkerMessage(msg);
    };

    worker.onerror = () => {
      setState({
        status: "error",
        progress: 0,
        statusMessage: ERROR_MESSAGES.WORKER_CRASHED,
        etaSeconds: null,
        errorCode: "WORKER_CRASHED",
        errorMessage: ERROR_MESSAGES.WORKER_CRASHED,
      });
    };

    workerRef.current = worker;
    worker.postMessage({ type: "INIT" });

    return () => {
      worker.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWorkerMessage = useCallback((msg: WorkerOutMessage) => {
    switch (msg.type) {
      case "READY":
        setWorkerProvider(msg.provider);
        setState({
          status: "ready",
          progress: 0,
          statusMessage: "Pronto. Selecione seu vídeo.",
          etaSeconds: null,
          errorCode: null,
          errorMessage: null,
        });
        break;

      case "PROGRESS": {
        const { stage, current, total, etaSeconds } = msg;
        const stageLabels: Record<string, string> = {
          extracting: "Preparando frames",
          inferring: "Detectando poses",
          detecting_phases: "Identificando fases",
        };
        const label = stageLabels[stage] ?? stage;

        // Progress ranges: extracting 0-30%, inferring 30-85%, detecting 85-95%
        let progress = 0;
        if (stage === "extracting")      progress = total > 0 ? (current / total) * 30 : 0;
        else if (stage === "inferring")  progress = 30 + (total > 0 ? (current / total) * 55 : 0);
        else if (stage === "detecting_phases") progress = 85;

        setState((prev) => ({
          ...prev,
          status: stage === "extracting" ? "extracting" : stage === "inferring" ? "inferring" : "detecting_phases",
          progress: Math.round(progress),
          statusMessage:
            total > 1
              ? `${label}… ${current}/${total}`
              : `${label}…`,
          etaSeconds,
        }));
        break;
      }

      case "RESULT":
        setResult((prev) => ({
          poseFrames: smoothPoseFrames(msg.poseFrames, 2),
          phases: msg.phases,
          keyFrameImages: msg.keyFrameImages,
          allFrameImages: prev?.allFrameImages ?? [],
          videoUrl: videoUrlRef.current ?? "",
          videoAspect: prev?.videoAspect ?? { w: 640, h: 640 },
        }));
        setState({
          status: "done",
          progress: 100,
          statusMessage: "Análise concluída.",
          etaSeconds: null,
          errorCode: null,
          errorMessage: null,
        });
        break;

      case "ERROR": {
        const message = ERROR_MESSAGES[msg.code] ?? msg.message;
        setState({
          status: "error",
          progress: 0,
          statusMessage: message,
          etaSeconds: null,
          errorCode: msg.code,
          errorMessage: message,
        });
        break;
      }
    }
  }, []);

  const processVideo = useCallback((file: File) => {
    // Revoke previous URL if any
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }

    setState({
      status: "extracting",
      progress: 0,
      statusMessage: "Preparando vídeo…",
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
    });
    setResult(null);

    extractFrames(file, (current, total) => {
      setState((prev) => ({
        ...prev,
        status: "extracting",
        progress: total > 0 ? Math.round((current / total) * 30) : 0,
        statusMessage: `Preparando frames… ${current}/${total}`,
      }));
    }).then(({ frames, allFrameImages, frameWidth, frameHeight, originalWidth, originalHeight, durationMs, videoUrl }) => {
      videoUrlRef.current = videoUrl;

      if (frames.length === 0) {
        setState({
          status: "error",
          progress: 0,
          statusMessage: ERROR_MESSAGES.VIDEO_READ_ERROR,
          etaSeconds: null,
          errorCode: "VIDEO_READ_ERROR",
          errorMessage: ERROR_MESSAGES.VIDEO_READ_ERROR,
        });
        return;
      }

      // Store aspect + allFrameImages so RESULT handler can attach them to the result
      setResult((prev) => prev
        ? { ...prev, allFrameImages, videoAspect: { w: originalWidth, h: originalHeight } }
        : { poseFrames: [], phases: { setup: 0, pop: 0, flick: 0, catch: 0, landing: 0, usedFallback: true }, keyFrameImages: {} as Record<PhaseName, ImageData>, allFrameImages, videoUrl, videoAspect: { w: originalWidth, h: originalHeight } }
      );

      // Transfer ImageBitmaps to worker (zero-copy)
      workerRef.current?.postMessage(
        { type: "PROCESS_VIDEO", frames, frameWidth, frameHeight, durationMs },
        frames as unknown as Transferable[],
      );
    }).catch(() => {
      setState({
        status: "error",
        progress: 0,
        statusMessage: ERROR_MESSAGES.VIDEO_READ_ERROR,
        etaSeconds: null,
        errorCode: "VIDEO_READ_ERROR",
        errorMessage: ERROR_MESSAGES.VIDEO_READ_ERROR,
      });
    });
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.postMessage({ type: "CANCEL" });
    setState({
      status: "ready",
      progress: 0,
      statusMessage: "Processamento cancelado.",
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
    });
    setResult(null);
  }, []);

  const reset = useCallback(() => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setResult(null);
    setState({
      status: "ready",
      progress: 0,
      statusMessage: "Pronto. Selecione seu vídeo.",
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
    });
  }, []);

  return { state, workerProvider, result, processVideo, cancel, reset };
}

// ─── Frame extraction (main thread — requires DOM) ────────────────────────────

const MAX_FRAMES = 600;
const TARGET_SIZE = 640;

type ExtractResult = {
  frames: ImageBitmap[];
  allFrameImages: ImageData[];
  frameWidth: number;
  frameHeight: number;
  originalWidth: number;
  originalHeight: number;
  durationMs: number;
  videoUrl: string;
};

// Primary: requestVideoFrameCallback — fires for every decoded frame in order,
// no keyframe alignment issues, exact timestamps.
// Fallback: seek-based for browsers without rVFC support (Firefox).
async function extractFrames(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<ExtractResult> {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    return extractFramesRVFC(file, onProgress);
  }
  return extractFramesSeek(file, onProgress);
}

// ── requestVideoFrameCallback implementation ──────────────────────────────────

function extractFramesRVFC(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement("canvas");
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const sampleCount = Math.min(MAX_FRAMES, Math.ceil(duration * 120));
      const interval = duration / sampleCount;
      const originalWidth = video.videoWidth;
      const originalHeight = video.videoHeight;
      // Scale so the longest side = TARGET_SIZE, preserving aspect ratio.
      // Portrait (height > width): frameHeight=640, frameWidth=round(640*w/h)
      // Landscape (width > height): frameWidth=640, frameHeight=round(640*h/w)
      const isPortrait = originalHeight > originalWidth;
      const frameWidth  = isPortrait ? Math.round(TARGET_SIZE * (originalWidth / originalHeight)) : TARGET_SIZE;
      const frameHeight = isPortrait ? TARGET_SIZE : Math.round(TARGET_SIZE * (originalHeight / originalWidth));
      canvas.width  = frameWidth;
      canvas.height = frameHeight;

      const allFrameImages: ImageData[] = [];
      let nextCaptureTime = 0;
      let finished = false;

      const onFrame = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (finished) return;

        const t = metadata.mediaTime;

        // Capture this frame if we've reached or passed the next target timestamp
        if (t >= nextCaptureTime - interval * 0.4) {
          ctx.drawImage(video, 0, 0, frameWidth, frameHeight);
          allFrameImages.push(ctx.getImageData(0, 0, frameWidth, frameHeight));
          nextCaptureTime = allFrameImages.length * interval;
          onProgress(allFrameImages.length, sampleCount);
        }

        if (allFrameImages.length >= sampleCount || t >= duration - interval * 0.5) {
          finished = true;
          video.pause();

          // Convert all ImageData → ImageBitmap (zero-copy transfer to worker)
          Promise.all(
            allFrameImages.map((id) => createImageBitmap(new ImageData(id.data, id.width, id.height)))
          ).then((bitmaps) => {
            resolve({
              frames: bitmaps,
              allFrameImages,
              frameWidth,
              frameHeight,
              originalWidth,
              originalHeight,
              durationMs: Math.round(duration * 1000),
              videoUrl: url,
            });
          }).catch(reject);
          return;
        }

        (video as any).requestVideoFrameCallback(onFrame);
      };

      // If the video ends before all frames are captured (can happen at 16x speed
      // when the last rVFC fires just before the end condition threshold), resolve
      // with whatever frames we have rather than hanging forever.
      video.onended = () => {
        if (!finished) {
          finished = true;
          Promise.all(
            allFrameImages.map((id) => createImageBitmap(new ImageData(id.data, id.width, id.height)))
          ).then((bitmaps) => {
            resolve({
              frames: bitmaps,
              allFrameImages,
              frameWidth,
              frameHeight,
              originalWidth,
              originalHeight,
              durationMs: Math.round(duration * 1000),
              videoUrl: url,
            });
          }).catch(reject);
        }
      };

      // playbackRate must stay at 1x: requestVideoFrameCallback fires once per
      // display refresh (~60Hz). At 2x the video advances 2 frames per callback,
      // so we'd only capture every other frame. At 16x we'd capture 1/16 of
      // frames with huge gaps — MediaPipe temporal tracking breaks completely.
      (video as any).requestVideoFrameCallback(onFrame);
      video.playbackRate = 1;
      video.play().catch(reject);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("VIDEO_LOAD_ERROR"));
    };

    video.src = url;
    video.load();
  });
}

// ── Seek-based fallback (Firefox) ─────────────────────────────────────────────

function extractFramesSeek(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement("canvas");
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const sampleCount = Math.min(MAX_FRAMES, Math.ceil(duration * 120));
      const interval = duration / sampleCount;
      const frames: ImageBitmap[] = [];
      const allFrameImages: ImageData[] = [];
      const originalWidth = video.videoWidth;
      const originalHeight = video.videoHeight;
      // Scale so the longest side = TARGET_SIZE, preserving aspect ratio.
      const isPortrait = originalHeight > originalWidth;
      const frameWidth  = isPortrait ? Math.round(TARGET_SIZE * (originalWidth / originalHeight)) : TARGET_SIZE;
      const frameHeight = isPortrait ? TARGET_SIZE : Math.round(TARGET_SIZE * (originalHeight / originalWidth));
      canvas.width  = frameWidth;
      canvas.height = frameHeight;

      for (let i = 0; i < sampleCount; i++) {
        const t = i * interval;
        try {
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, frameWidth, frameHeight);
          allFrameImages.push(ctx.getImageData(0, 0, frameWidth, frameHeight));
          const bitmap = await createImageBitmap(canvas);
          frames.push(bitmap);
        } catch {
          // skip frame on seek error
        }
        onProgress(i + 1, sampleCount);
      }

      resolve({
        frames,
        allFrameImages,
        frameWidth,
        frameHeight,
        originalWidth,
        originalHeight,
        durationMs: Math.round(duration * 1000),
        videoUrl: url,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("VIDEO_LOAD_ERROR"));
    };

    video.src = url;
    video.load();
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - t) < 0.001) { resolve(); return; }
    const onSeeked = () => { resolve(); };
    const onErr = () => { reject(new Error("SEEK_ERROR")); };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = t;
  });
}
