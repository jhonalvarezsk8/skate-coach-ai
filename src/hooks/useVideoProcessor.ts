"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, Keypoint, PoseFrame, ReferenceData } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Este hook agora:
//   1. Extrai frames locais (ImageData[]) para dar scrubbing fluido no canvas.
//   2. Envia o arquivo de vídeo para /api/analyze (Python rodando no Vercel).
//   3. Converte o JSON retornado em PoseFrame[] (mesma forma de consumo da UI).
// Toda a inferência (MediaPipe) foi movida para o servidor. Não há mais worker.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessingResult {
  poseFrames: PoseFrame[];
  rawPoseFrames: PoseFrame[];
  allFrameImages: ImageData[];
  videoUrl: string;
  videoAspect: { w: number; h: number };
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
  status: "ready",
  progress: 0,
  statusMessage: "Pronto. Selecione seu vídeo.",
  etaSeconds: null,
  errorCode: null,
  errorMessage: null,
};

const ERROR_MESSAGES: Record<string, string> = {
  EMPTY_BODY:
    "Não foi possível ler o vídeo enviado.",
  ANALYZE_FAILED:
    "Falha ao analisar o vídeo no servidor. Tente novamente.",
  VIDEO_READ_ERROR:
    "Não foi possível ler o vídeo. Tente outro arquivo.",
  NO_PERSON_DETECTED:
    "Nenhum skatista detectado. Certifique-se que o skatista está visível no vídeo inteiro.",
  UPLOAD_TOO_LARGE:
    "Vídeo muito grande para envio. Use um vídeo menor (até ~20 MB).",
};

export function useVideoProcessor(): UseVideoProcessorReturn {
  const [state, setState]   = useState<AppState>(INITIAL_STATE);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const reportError = useCallback((code: string, fallback?: string) => {
    const message = ERROR_MESSAGES[code] ?? fallback ?? "Erro ao processar o vídeo.";
    setState({
      status: "error",
      progress: 0,
      statusMessage: message,
      etaSeconds: null,
      errorCode: code,
      errorMessage: message,
    });
  }, []);

  const processVideo = useCallback(async (file: File) => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }

    setResult(null);
    setState({
      status: "extracting",
      progress: 0,
      statusMessage: "Preparando vídeo…",
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
    });

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;

    try {
      // ── 1. Extrai frames localmente (só pra scrubber) ─────────────────────
      const extracted = await extractFrames(file, (current, total) => {
        setState((prev) => ({
          ...prev,
          status: "extracting",
          progress: total > 0 ? Math.round((current / total) * 30) : 0,
          statusMessage: `Preparando frames… ${current}/${total}`,
        }));
      });

      if (ctrl.signal.aborted) return;

      videoUrlRef.current = extracted.videoUrl;

      if (extracted.allFrameImages.length === 0) {
        reportError("VIDEO_READ_ERROR");
        return;
      }

      // ── 2. Envia pro servidor ─────────────────────────────────────────────
      setState({
        status: "inferring",
        progress: 40,
        statusMessage: "Enviando para análise…",
        etaSeconds: null,
        errorCode: null,
        errorMessage: null,
      });

      const analyzeUrl =
        process.env.NEXT_PUBLIC_ANALYZE_URL ?? "/api/analyze";
      const res = await fetch(analyzeUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
        signal: ctrl.signal,
      });

      if (!res.ok) {
        if (res.status === 413) { reportError("UPLOAD_TOO_LARGE"); return; }
        const errBody = await res.json().catch(() => ({} as { error?: string; message?: string }));
        reportError(errBody.error ?? "ANALYZE_FAILED", errBody.message);
        return;
      }

      setState((prev) => ({
        ...prev,
        progress: 75,
        statusMessage: "Recebendo resultado…",
      }));

      const refData = (await res.json()) as ReferenceData;
      if (ctrl.signal.aborted) return;

      // ── 3. Converte o JSON em PoseFrame[] alinhado aos frames locais ─────
      const poseFrames = referenceToPoseFrames(refData, extracted.frameTimestampsMs);
      const detected = poseFrames.filter((f) => f.detectionConf > 0.3).length;
      if (detected < poseFrames.length * 0.1) {
        reportError("NO_PERSON_DETECTED");
        return;
      }

      setResult({
        poseFrames,
        rawPoseFrames: poseFrames,
        allFrameImages: extracted.allFrameImages,
        videoUrl: extracted.videoUrl,
        videoAspect: { w: extracted.originalWidth, h: extracted.originalHeight },
      });
      setState({
        status: "done",
        progress: 100,
        statusMessage: "Análise concluída.",
        etaSeconds: null,
        errorCode: null,
        errorMessage: null,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      reportError("ANALYZE_FAILED", (err as Error)?.message);
    }
  }, [reportError]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
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
    abortRef.current?.abort();
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

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    state,
    workerProvider: "server-python",
    result,
    processVideo,
    cancel,
    reset,
  };
}

// ─── Converte ReferenceData → PoseFrame[] ───────────────────────────────────
// Para cada frame local extraído, mapeia o timestamp real (em ms) para o frame
// correspondente do Python via round(t_segundos * fps). Isso elimina o "delay"
// visual que surgia com mapeamento por índice quando o número de frames local
// diverge do número de frames nativos do Python (ex: rVFC a 60fps captura
// mais frames que o Python em vídeo de 30fps).
function referenceToPoseFrames(data: ReferenceData, frameTimestampsMs: number[]): PoseFrame[] {
  const srcW = data.frameWidth  ?? 1080;
  const srcH = data.frameHeight ?? 1920;
  const srcFrames = data.frames;
  if (srcFrames.length === 0) return [];

  const out: PoseFrame[] = [];
  for (let i = 0; i < frameTimestampsMs.length; i++) {
    const tMs = frameTimestampsMs[i];
    const tSec = tMs / 1000;
    const srcIdx = Math.max(
      0,
      Math.min(srcFrames.length - 1, Math.round(tSec * data.fps)),
    );
    const srcFrame = srcFrames[srcIdx];

    const keypoints: Keypoint[] = [];
    if (srcFrame.keypoints) {
      for (let k = 0; k < srcFrame.keypoints.length; k++) {
        const [x, y] = srcFrame.keypoints[k];
        keypoints.push({
          x,
          y,
          visibility: srcFrame.confidence[k] ?? 0.9,
        });
      }
    }
    while (keypoints.length < 33) {
      keypoints.push({ x: 0, y: 0, visibility: 0 });
    }

    const conf = keypoints.slice(11, 25)
      .map((k) => k.visibility)
      .reduce((a, b) => a + b, 0) / 14;

    out.push({
      frameIndex:    i,
      timestampMs:   tMs,
      keypoints,
      detectionConf: conf,
      frameWidth:    srcW,
      frameHeight:   srcH,
    });
  }
  return out;
}

// ─── Frame extraction (main thread — mantido só pra scrubber) ───────────────

const MAX_FRAMES = 600;
const TARGET_SIZE = 720;

type ExtractResult = {
  allFrameImages: ImageData[];
  frameTimestampsMs: number[];
  frameWidth: number;
  frameHeight: number;
  originalWidth: number;
  originalHeight: number;
  durationMs: number;
  videoUrl: string;
};

async function extractFrames(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<ExtractResult> {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    return extractFramesRVFC(file, onProgress);
  }
  return extractFramesSeek(file, onProgress);
}

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
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const sampleCount = Math.min(MAX_FRAMES, Math.ceil(duration * 60));
      const interval = duration / sampleCount;
      const originalWidth  = video.videoWidth;
      const originalHeight = video.videoHeight;
      const isPortrait = originalHeight > originalWidth;
      const frameWidth  = isPortrait ? Math.round(TARGET_SIZE * (originalWidth / originalHeight)) : TARGET_SIZE;
      const frameHeight = isPortrait ? TARGET_SIZE : Math.round(TARGET_SIZE * (originalHeight / originalWidth));
      canvas.width  = frameWidth;
      canvas.height = frameHeight;

      const allFrameImages: ImageData[] = [];
      const frameTimestampsMs: number[] = [];
      let nextCaptureTime = 0;
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        video.pause();
        resolve({
          allFrameImages,
          frameTimestampsMs,
          frameWidth,
          frameHeight,
          originalWidth,
          originalHeight,
          durationMs: Math.round(duration * 1000),
          videoUrl: url,
        });
      };

      const onFrame = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (finished) return;
        const t = metadata.mediaTime;

        if (t >= nextCaptureTime - interval * 0.4) {
          ctx.drawImage(video, 0, 0, frameWidth, frameHeight);
          allFrameImages.push(ctx.getImageData(0, 0, frameWidth, frameHeight));
          frameTimestampsMs.push(Math.round(t * 1000));
          nextCaptureTime = allFrameImages.length * interval;
          onProgress(allFrameImages.length, sampleCount);
        }

        if (allFrameImages.length >= sampleCount || t >= duration - interval * 0.5) {
          done();
          return;
        }
        (video as unknown as { requestVideoFrameCallback: (cb: typeof onFrame) => void })
          .requestVideoFrameCallback(onFrame);
      };

      video.onended = done;

      (video as unknown as { requestVideoFrameCallback: (cb: typeof onFrame) => void })
        .requestVideoFrameCallback(onFrame);
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const sampleCount = Math.min(MAX_FRAMES, Math.ceil(duration * 60));
      const interval = duration / sampleCount;
      const allFrameImages: ImageData[] = [];
      const frameTimestampsMs: number[] = [];
      const originalWidth  = video.videoWidth;
      const originalHeight = video.videoHeight;
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
          frameTimestampsMs.push(Math.round(t * 1000));
        } catch { /* skip */ }
        onProgress(i + 1, sampleCount);
      }

      resolve({
        allFrameImages,
        frameTimestampsMs,
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
    const onSeeked = () => resolve();
    const onErr    = () => reject(new Error("SEEK_ERROR"));
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error",  onErr,    { once: true });
    video.currentTime = t;
  });
}
