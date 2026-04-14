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
          poseFrames: smoothPoseFrames(msg.poseFrames, 3),
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

const MAX_FRAMES = 150;
const TARGET_SIZE = 640;

async function extractFrames(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<{
  frames: ImageBitmap[];
  allFrameImages: ImageData[];
  frameWidth: number;
  frameHeight: number;
  originalWidth: number;
  originalHeight: number;
  durationMs: number;
  videoUrl: string;
}> {
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
      const sampleCount = Math.min(MAX_FRAMES, Math.ceil(duration * 30));
      const interval = duration / sampleCount;
      const frames: ImageBitmap[] = [];
      const allFrameImages: ImageData[] = [];
      const originalWidth = video.videoWidth;
      const originalHeight = video.videoHeight;

      for (let i = 0; i < sampleCount; i++) {
        const t = i * interval;
        try {
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, TARGET_SIZE, TARGET_SIZE);
          allFrameImages.push(ctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE));
          const bitmap = await createImageBitmap(canvas);
          frames.push(bitmap);
        } catch {
          // skip frame on seek error
        }
        onProgress(i + 1, sampleCount);
      }

      // Note: we do NOT revoke the URL here — it is kept alive for the scrubber video element
      resolve({
        frames,
        allFrameImages,
        frameWidth: TARGET_SIZE,
        frameHeight: TARGET_SIZE,
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
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      reject(new Error("SEEK_ERROR"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = t;
  });
}
