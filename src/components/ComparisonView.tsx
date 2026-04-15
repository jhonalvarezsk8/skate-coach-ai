"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { PoseFrame, ReferenceData, PhaseName } from "@/types";
import FeedbackPanel from "./FeedbackPanel";
import { refFrameToPoseFrame } from "@/lib/reference/referenceLoader";
import { drawSkeleton } from "@/lib/skeleton/skeletonRenderer";

interface Props {
  userPoseFrames: PoseFrame[];
  userKeyFrameImages: Record<PhaseName, ImageData>;
  allFrameImages: ImageData[];
  referenceData: ReferenceData;
  videoUrl: string;
  videoAspect: { w: number; h: number };
}

function nearestPoseFrame(frames: PoseFrame[], timeMs: number): PoseFrame | null {
  if (frames.length === 0) return null;
  return frames.reduce((best, f) =>
    Math.abs(f.timestampMs - timeMs) < Math.abs(best.timestampMs - timeMs) ? f : best
  );
}

type UIMode = "comparison" | "syncing";

export default function ComparisonView({
  userPoseFrames,
  allFrameImages,
  referenceData,
  videoAspect,
}: Props) {
  // ── UI mode ───────────────────────────────────────────────────────────────
  const [uiMode, setUIMode] = useState<UIMode>("comparison");

  // ── Crop state ─────────────────────────────────────────────────────────────
  const [cropStart, setCropStart] = useState<number | null>(null);
  const [cropEnd,   setCropEnd]   = useState<number | null>(null);

  // ── Sync mode scrubber (user video only) ───────────────────────────────────
  const [userSyncPos, setUserSyncPos] = useState(0);

  // ── Durations & fps ────────────────────────────────────────────────────────
  const totalDurationMs =
    userPoseFrames.length > 0
      ? userPoseFrames[userPoseFrames.length - 1].timestampMs
      : allFrameImages.length > 0
        ? (allFrameImages.length / 30) * 1000
        : 0;

  const userDuration = totalDurationMs / 1000;
  const refDuration  = referenceData.fps > 0 ? referenceData.totalFrames / referenceData.fps : 0;
  const userFps      = userDuration > 0 ? allFrameImages.length / userDuration : 30;

  // ── Reference sync point: 0.80s — moment back foot leaves the ground ────────
  const syncTimeRef   = 0.80; // seconds (fixed)
  const syncFrameRef  = Math.round(syncTimeRef * referenceData.fps);
  // Frames before/after sync point in the reference
  const refFramesBefore = syncFrameRef;
  const refFramesAfter  = referenceData.totalFrames - 1 - syncFrameRef;

  const formatTime = (s: number) => {
    const m   = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2).padStart(5, "0");
    return `${m}:${sec}`;
  };

  // ── Comparison scrubber ────────────────────────────────────────────────────
  const [syncPos, setSyncPos] = useState(0);
  const syncPosRef = useRef(0);
  const rafRef     = useRef<number | null>(null);

  // ── Skeleton highlight ─────────────────────────────────────────────────────
  const [skeletonHighlight, setSkeletonHighlight] = useState(false);
  const skeletonHighlightRef = useRef(false);

  // ── Overlay opacity (skeleton mode) ───────────────────────────────────────
  const [overlayAlpha, setOverlayAlpha] = useState(0.65);
  const overlayAlphaRef = useRef(0.65);

  // ── Playback ───────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const rafPlayRef   = useRef<number | null>(null);
  const lastTsRef    = useRef<number>(0);

  // ── Playback speed ─────────────────────────────────────────────────────────
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const playbackSpeedRef = useRef(1.0);

  // ── Canvas refs ────────────────────────────────────────────────────────────
  const refVideoRef      = useRef<HTMLVideoElement>(null);
  const userCanvasRef    = useRef<HTMLCanvasElement>(null);
  const refCanvasRef     = useRef<HTMLCanvasElement>(null);
  const userOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const refOffscreenRef  = useRef<HTMLCanvasElement | null>(null);

  const [refAspect, setRefAspect] = useState<{ w: number; h: number }>({ w: 9, h: 16 });
  const [activeUserFrame, setActiveUserFrame] = useState<PoseFrame | null>(null);

  const refFrameImagesRef = useRef<ImageData[]>([]);
  const [refReady, setRefReady] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function drawImageToCanvas(
    canvas: HTMLCanvasElement,
    imageData: ImageData,
    offscreenRef: React.MutableRefObject<HTMLCanvasElement | null>,
    w: number,
    h: number,
    overlayAlpha: string,
  ) {
    const ctx = canvas.getContext("2d")!;
    canvas.width  = w;
    canvas.height = h;
    const off = offscreenRef.current ?? (offscreenRef.current = document.createElement("canvas"));
    if (off.width !== imageData.width || off.height !== imageData.height) {
      off.width  = imageData.width;
      off.height = imageData.height;
    }
    off.getContext("2d")!.putImageData(imageData, 0, 0);
    ctx.drawImage(off, 0, 0, w, h);
    ctx.fillStyle = `rgba(0,0,0,${overlayAlpha})`;
    ctx.fillRect(0, 0, w, h);
    return ctx;
  }

  // ── Resolve positions (comparison mode) ───────────────────────────────────
  function resolvePositions(pos: number): { userPos: number; refPos: number } {
    if (cropStart !== null && cropEnd !== null) {
      const totalCropFrames = cropEnd - cropStart + 1;
      const userFrameIdx = cropStart + Math.round(pos * (totalCropFrames - 1));
      return {
        refPos:  pos,
        userPos: Math.min(userFrameIdx, allFrameImages.length - 1) / Math.max(allFrameImages.length - 1, 1),
      };
    }
    return { refPos: pos, userPos: pos };
  }

  // ── Draw user canvas ───────────────────────────────────────────────────────
  function drawUserCanvas(userPos: number, highlight: boolean) {
    const canvas = userCanvasRef.current;
    if (!canvas) return;
    const uW = canvas.offsetWidth || 360;
    const uH = Math.round(uW * (videoAspect.h / videoAspect.w));
    const frameIdx  = Math.round(userPos * (allFrameImages.length - 1));
    const imageData = allFrameImages[frameIdx];

    const ctx = canvas.getContext("2d")!;
    canvas.width  = uW;
    canvas.height = uH;

    if (imageData) {
      drawImageToCanvas(canvas, imageData, userOffscreenRef, uW, uH,
        highlight ? overlayAlphaRef.current.toString() : "0.35");
      const timeMs    = userPos * totalDurationMs;
      const poseFrame = nearestPoseFrame(userPoseFrames, timeMs);
      setActiveUserFrame(poseFrame);
      if (poseFrame) {
        drawSkeleton(ctx, poseFrame.keypoints, "user",
          { x: uW / poseFrame.frameWidth, y: uH / poseFrame.frameHeight });
      }
    } else {
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, uW, uH);
    }
  }

  // ── Draw reference canvas ──────────────────────────────────────────────────
  function drawRefCanvas(refPos: number, highlight: boolean) {
    const canvas = refCanvasRef.current;
    if (!canvas) return;
    const rW = canvas.offsetWidth || 360;
    const rH = Math.round(rW * (refAspect.h / refAspect.w));
    const refFrameIdx = Math.round(refPos * (referenceData.totalFrames - 1));
    const refImages   = refFrameImagesRef.current;

    const ctx = canvas.getContext("2d")!;
    canvas.width  = rW;
    canvas.height = rH;

    if (refImages.length > 0 && refImages[refFrameIdx]) {
      drawImageToCanvas(canvas, refImages[refFrameIdx], refOffscreenRef, rW, rH,
        highlight ? overlayAlphaRef.current.toString() : "0.35");
      const refRawFrame  = referenceData.frames[refFrameIdx];
      const srcW = referenceData.frameWidth  ?? 1080;
      const srcH = referenceData.frameHeight ?? 1920;
      const refPoseFrame = refRawFrame
        ? refFrameToPoseFrame(refRawFrame, srcW, srcH, rW, rH)
        : null;
      if (refPoseFrame) {
        drawSkeleton(ctx, refPoseFrame.keypoints, "reference",
          { x: rW / refPoseFrame.frameWidth, y: rH / refPoseFrame.frameHeight });
      }
    } else {
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, rW, rH);
      ctx.fillStyle = "#525252";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(refImages.length === 0 ? "Carregando referência…" : "", rW / 2, rH / 2);
    }
  }

  // ── Draw all (comparison mode) ─────────────────────────────────────────────
  const drawAll = useCallback((userPos: number, refPos: number, highlight: boolean) => {
    drawUserCanvas(userPos, highlight);
    drawRefCanvas(refPos,   highlight);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPoseFrames, referenceData, videoAspect, refAspect, allFrameImages, totalDurationMs]);

  const scheduleDraw = useCallback((pos: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const { userPos, refPos } = resolvePositions(pos);
      drawAll(userPos, refPos, skeletonHighlightRef.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawAll, cropStart, cropEnd, allFrameImages.length]);

  // ── Playback ───────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    if (rafPlayRef.current !== null) {
      cancelAnimationFrame(rafPlayRef.current);
      rafPlayRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(() => {
    isPlayingRef.current = true;
    lastTsRef.current = performance.now();
    const tick = (now: number) => {
      if (!isPlayingRef.current) return;
      const delta = now - lastTsRef.current;
      lastTsRef.current = now;
      let pos = syncPosRef.current + (delta * playbackSpeedRef.current) / (refDuration * 1000);
      if (pos >= 1) pos = 0;
      syncPosRef.current = pos;
      setSyncPos(pos);
      const { userPos, refPos } = resolvePositions(pos);
      drawAll(userPos, refPos, skeletonHighlightRef.current);
      rafPlayRef.current = requestAnimationFrame(tick);
    };
    rafPlayRef.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refDuration, drawAll, cropStart, cropEnd, allFrameImages.length]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const refVideo = refVideoRef.current;
    if (!refVideo) return;
    const onMeta = () => setRefAspect({ w: refVideo.videoWidth, h: refVideo.videoHeight });
    refVideo.addEventListener("loadedmetadata", onMeta, { once: true });
    if (refVideo.readyState >= 1) onMeta();
    return () => refVideo.removeEventListener("loadedmetadata", onMeta);
  }, []);

  useEffect(() => {
    if (allFrameImages.length > 0 && uiMode === "comparison") {
      scheduleDraw(syncPosRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFrameImages]);

  useEffect(() => {
    if (refReady && uiMode === "comparison") scheduleDraw(syncPosRef.current);
    if (refReady && uiMode === "syncing") {
      // Draw reference frozen at sync point
      const syncRefPos = syncFrameRef / Math.max(referenceData.totalFrames - 1, 1);
      drawRefCanvas(syncRefPos, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refReady, uiMode]);

  // Extract reference frames
  useEffect(() => {
    const video = refVideoRef.current;
    if (!video) return;
    let cancelled = false;
    const extract = async () => {
      if (video.readyState < 1) {
        await new Promise<void>(resolve => {
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });
      }
      if (cancelled) return;
      const totalFrames = referenceData.totalFrames;
      const duration    = video.duration;
      const extractW    = 640;
      const extractH    = Math.round(640 * (video.videoHeight / Math.max(video.videoWidth, 1)));
      const canvas = document.createElement("canvas");
      canvas.width = extractW; canvas.height = extractH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const images: ImageData[] = [];
      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) return;
        const t = ((i + 0.5) / totalFrames) * duration;
        await new Promise<void>(resolve => {
          video.addEventListener("seeked", () => resolve(), { once: true });
          video.currentTime = t;
        });
        if (cancelled) return;
        ctx.drawImage(video, 0, 0, extractW, extractH);
        images.push(ctx.getImageData(0, 0, extractW, extractH));
      }
      refFrameImagesRef.current = images;
      setRefReady(true);
    };
    extract().catch(() => {});
    return () => { cancelled = true; };
  }, [referenceData.totalFrames]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleComparisonScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value);
    syncPosRef.current = pos;
    setSyncPos(pos);
    scheduleDraw(pos);
  };

  const handleUserSyncScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value);
    setUserSyncPos(pos);
    // Draw user canvas only (ref stays frozen)
    requestAnimationFrame(() => drawUserCanvas(pos, false));
  };

  const handleEnterSync = () => {
    stopPlayback();
    setIsPlaying(false);
    // Pre-position scrubber: if crop already set, show cropStart frame; else middle of video
    const prePos = cropStart !== null
      ? (cropStart + Math.round(syncTimeRef * userFps)) / Math.max(allFrameImages.length - 1, 1)
      : 0.3;
    setUserSyncPos(prePos);
    setUIMode("syncing");
    requestAnimationFrame(() => {
      drawUserCanvas(prePos, false);
      const syncRefPos = syncFrameRef / Math.max(referenceData.totalFrames - 1, 1);
      drawRefCanvas(syncRefPos, false);
    });
  };

  const handleConfirmSync = () => {
    // userSyncPos points to the moment the back foot leaves the ground in user video
    const userSyncFrame = Math.round(userSyncPos * (allFrameImages.length - 1));
    const framesBefore  = Math.round(syncTimeRef * userFps);
    const framesAfter   = Math.round((refDuration - syncTimeRef) * userFps);

    const newCropStart = Math.max(0, userSyncFrame - framesBefore);
    const newCropEnd   = Math.min(allFrameImages.length - 1, userSyncFrame + framesAfter);

    setCropStart(newCropStart);
    setCropEnd(newCropEnd);
    syncPosRef.current = 0;
    setSyncPos(0);
    setUIMode("comparison");

    requestAnimationFrame(() => {
      const totalCropFrames = newCropEnd - newCropStart + 1;
      const userFrameIdx    = newCropStart;
      const userPos = userFrameIdx / Math.max(allFrameImages.length - 1, 1);
      drawAll(userPos, 0, false);
    });
  };

  const handleCancelSync = () => {
    setUIMode("comparison");
    requestAnimationFrame(() => scheduleDraw(syncPosRef.current));
  };

  const handleSkeletonHighlight = () => {
    const next = !skeletonHighlight;
    skeletonHighlightRef.current = next;
    setSkeletonHighlight(next);
    scheduleDraw(syncPosRef.current);
  };

  const handleOverlayAlpha = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    overlayAlphaRef.current = val;
    setOverlayAlpha(val);
    scheduleDraw(syncPosRef.current);
  };

  const handlePlayToggle = () => {
    if (isPlaying) { stopPlayback(); setIsPlaying(false); }
    else           { startPlayback(); setIsPlaying(true); }
  };

  const handlePlaybackSpeed = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    playbackSpeedRef.current = val;
    setPlaybackSpeed(val);
  };

  // ── Derived display values ─────────────────────────────────────────────────
  const syncRefTimeSec = syncPos * refDuration;
  const syncUserTimeSec = (() => {
    if (cropStart === null || cropEnd === null) return syncPos * userDuration;
    const totalCropFrames = cropEnd - cropStart + 1;
    const userFrameIdx = cropStart + Math.round(syncPos * (totalCropFrames - 1));
    return (userFrameIdx / Math.max(allFrameImages.length - 1, 1)) * userDuration;
  })();

  const userSyncTimeSec = userSyncPos * userDuration;

  // Check if crop will exceed video bounds
  const userSyncFrame   = Math.round(userSyncPos * (allFrameImages.length - 1));
  const framesBefore    = Math.round(syncTimeRef * userFps);
  const framesAfter     = Math.round((refDuration - syncTimeRef) * userFps);
  const syncCropStart   = userSyncFrame - framesBefore;
  const syncCropEnd     = userSyncFrame + framesAfter;
  const syncStartsBeforeVideo = syncCropStart < 0;
  const syncEndsAfterVideo    = syncCropEnd >= allFrameImages.length;
  const syncCanConfirm  = !syncStartsBeforeVideo && !syncEndsAfterVideo;

  // ── Render: sync mode ──────────────────────────────────────────────────────
  if (uiMode === "syncing") {
    return (
      <div className="w-full flex flex-col gap-4">
        <div className="text-center">
          <p className="text-sm text-neutral-200 font-medium">
            Sincronize sua manobra com o vídeo de referência
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            A referência está congelada no momento em que o pé de trás decola ({formatTime(syncTimeRef)}).
            Arraste sua barra até o mesmo momento no seu vídeo.
          </p>
        </div>

        {/* Side by side: user (scrubable) + reference (frozen) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* User video — scrubable */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-neutral-400 text-center">
              Seu vídeo — <span className="text-red-400">arraste até o pé de trás decolar</span>
            </span>
            <div
              className="relative w-full border-2 border-red-500 rounded-lg overflow-hidden bg-neutral-900"
              style={{ aspectRatio: `${videoAspect.w} / ${videoAspect.h}` }}
            >
              <canvas ref={userCanvasRef} className="absolute inset-0 w-full h-full" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-neutral-500 w-12 text-right">
                {formatTime(userSyncTimeSec)}
              </span>
              <input
                type="range" min="0" max="1" step="0.001"
                value={userSyncPos}
                onChange={handleUserSyncScrub}
                className="flex-1 h-4 rounded-full appearance-none bg-neutral-700 cursor-pointer accent-red-500"
              />
              <span className="text-xs font-mono text-neutral-500 w-12">
                {formatTime(userDuration)}
              </span>
            </div>
            {/* Crop bounds warning */}
            {syncStartsBeforeVideo && (
              <p className="text-xs text-yellow-500 text-center">
                Muito perto do início — avance {formatTime(Math.abs(syncCropStart) / userFps)} para frente
              </p>
            )}
            {syncEndsAfterVideo && (
              <p className="text-xs text-yellow-500 text-center">
                Muito perto do fim — recue {formatTime((syncCropEnd - allFrameImages.length + 1) / userFps)}
              </p>
            )}
          </div>

          {/* Reference — frozen at sync point */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-neutral-400 text-center">
              Referência — <span className="text-green-400">congelada no ponto de sincronização</span>
            </span>
            <div
              className="relative w-full border-2 border-green-500 rounded-lg overflow-hidden bg-neutral-900"
              style={{ aspectRatio: `${refAspect.w} / ${refAspect.h}` }}
            >
              <canvas ref={refCanvasRef} className="absolute inset-0 w-full h-full" />
            </div>
            <p className="text-xs font-mono text-center text-neutral-600">
              Congelado em {formatTime(syncTimeRef)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-center gap-3">
          <button
            onClick={handleCancelSync}
            className="px-5 py-2 rounded text-sm font-medium bg-neutral-700 text-neutral-200 hover:bg-neutral-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirmSync}
            disabled={!syncCanConfirm}
            className="px-5 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            Sincronizar
          </button>
        </div>

        {/* Hidden reference video */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={refVideoRef} src="/reference/ollie-reference.mp4" preload="auto" muted playsInline className="hidden" />
      </div>
    );
  }

  // ── Render: comparison mode ────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex justify-center gap-2 flex-wrap">
          <button
            onClick={handleEnterSync}
            title="Sincronize seu vídeo com a referência pelo ponto de decolagem"
            className={`px-4 py-2 rounded text-sm font-medium transition-colors min-w-[44px] ${
              cropStart !== null
                ? "bg-green-700 text-white hover:bg-green-800"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {cropStart !== null ? "Ressincronizar" : "Sincronizar manobra"}
          </button>
          <button
            onClick={handleSkeletonHighlight}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors min-w-[44px] ${
              skeletonHighlight
                ? "bg-white text-black"
                : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
            }`}
          >
            Esqueleto
          </button>
          <button
            onClick={handlePlayToggle}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors min-w-[44px] ${
              isPlaying
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
            }`}
          >
            {isPlaying ? "Parar" : "Reproduzir"}
          </button>
        </div>

        {/* Opacity slider — visible when skeleton mode is on */}
        {skeletonHighlight && (
          <div className="flex items-center gap-3 w-full max-w-xs">
            <span className="text-xs text-neutral-400 w-16 text-right">Opacidade</span>
            <input
              type="range" min="0.1" max="0.95" step="0.05"
              value={overlayAlpha}
              onChange={handleOverlayAlpha}
              className="flex-1 h-2 rounded-full appearance-none bg-neutral-700 cursor-pointer accent-white"
            />
            <span className="text-xs font-mono text-neutral-500 w-8">
              {Math.round(overlayAlpha * 100)}%
            </span>
          </div>
        )}

        {/* Speed slider — visible when playing */}
        {isPlaying && (
          <div className="flex items-center gap-3 w-full max-w-xs">
            <span className="text-xs text-neutral-400 w-16 text-right">Velocidade</span>
            <input
              type="range" min="0.1" max="3" step="0.1"
              value={playbackSpeed}
              onChange={handlePlaybackSpeed}
              className="flex-1 h-2 rounded-full appearance-none bg-neutral-700 cursor-pointer accent-red-500"
            />
            <span className="text-xs font-mono text-neutral-500 w-8">
              {playbackSpeed.toFixed(1)}x
            </span>
          </div>
        )}
      </div>

      {/* Side-by-side canvases */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400 text-center">Seu Ollie</span>
          <div
            className="relative w-full border-2 border-red-500 rounded-lg overflow-hidden bg-neutral-900"
            style={{ aspectRatio: `${videoAspect.w} / ${videoAspect.h}` }}
          >
            <canvas ref={userCanvasRef} className="absolute inset-0 w-full h-full" />
          </div>
          <p className="text-xs font-mono text-center text-neutral-600">{formatTime(syncUserTimeSec)}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400 text-center">
            Referência Pro{!refReady && <span className="ml-1 text-neutral-600">(carregando…)</span>}
          </span>
          <div
            className="relative w-full border-2 border-green-500 rounded-lg overflow-hidden bg-neutral-900"
            style={{ aspectRatio: `${refAspect.w} / ${refAspect.h}` }}
          >
            <canvas ref={refCanvasRef} className="absolute inset-0 w-full h-full" />
          </div>
          <p className="text-xs font-mono text-center text-neutral-600">{formatTime(syncRefTimeSec)}</p>
        </div>
      </div>

      {/* Scrubber */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-neutral-500 w-12 text-right">
            {formatTime(syncRefTimeSec)}
          </span>
          <input
            type="range" min="0" max="1" step="0.001"
            value={syncPos}
            onChange={handleComparisonScrub}
            disabled={isPlaying}
            className="flex-1 h-4 rounded-full appearance-none bg-neutral-700 cursor-pointer accent-red-500 disabled:opacity-40 disabled:cursor-default"
          />
          <span className="text-xs font-mono text-neutral-500 w-12">
            {formatTime(refDuration)}
          </span>
        </div>
        <p className="text-xs text-neutral-600 text-center">
          {cropStart !== null
            ? "Sincronizado — arraste para comparar frame a frame"
            : "Clique em \"Sincronizar manobra\" para alinhar os vídeos"
          }
        </p>
      </div>

      {/* Hidden reference video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={refVideoRef} src="/reference/ollie-reference.mp4" preload="auto" muted playsInline className="hidden" />

      {/* Feedback */}
      {activeUserFrame && (
        <FeedbackPanel
          userFrames={userPoseFrames}
          phases={{ setup: 0, pop: 0, flick: 0, catch: 0, landing: 0, usedFallback: true }}
          activePhase="setup"
        />
      )}
    </div>
  );
}
