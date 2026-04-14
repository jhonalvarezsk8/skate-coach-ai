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

// Find the poseFrame whose timestamp is closest to the given time in ms
function nearestPoseFrame(frames: PoseFrame[], timeMs: number): PoseFrame | null {
  if (frames.length === 0) return null;
  return frames.reduce((best, f) =>
    Math.abs(f.timestampMs - timeMs) < Math.abs(best.timestampMs - timeMs) ? f : best
  );
}

export default function ComparisonView({
  userPoseFrames,
  allFrameImages,
  referenceData,
  videoAspect,
}: Props) {
  const [scrubPos, setScrubPos] = useState(0); // 0..1
  const scrubPosRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const refVideoRef    = useRef<HTMLVideoElement>(null);
  const userCanvasRef  = useRef<HTMLCanvasElement>(null);
  const refCanvasRef   = useRef<HTMLCanvasElement>(null);

  const userOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const refOffscreenRef  = useRef<HTMLCanvasElement | null>(null);

  const [refAspect, setRefAspect] = useState<{ w: number; h: number }>({ w: 9, h: 16 });
  const [activeUserFrame, setActiveUserFrame] = useState<PoseFrame | null>(null);

  const refFrameImagesRef = useRef<ImageData[]>([]);
  const [refReady, setRefReady] = useState(false);

  // ── Derive total duration from pose frames ───────────────────────────────
  const totalDurationMs =
    userPoseFrames.length > 0
      ? userPoseFrames[userPoseFrames.length - 1].timestampMs
      : allFrameImages.length > 0
        ? (allFrameImages.length / 30) * 1000
        : 0;

  // ── Draw ──────────────────────────────────────────────────────────────────

  const drawAll = useCallback((pos: number) => {
    const uW = userCanvasRef.current?.offsetWidth ?? 360;
    const uH = Math.round(uW * (videoAspect.h / videoAspect.w));
    const rW = refCanvasRef.current?.offsetWidth ?? 360;
    const rH = Math.round(rW * (refAspect.h / refAspect.w));

    // ── User canvas ──────────────────────────────────────────────────────────
    const userCanvas = userCanvasRef.current;
    if (userCanvas) {
      const ctx = userCanvas.getContext("2d")!;
      userCanvas.width  = uW;
      userCanvas.height = uH;

      const frameIdx = Math.round(pos * (allFrameImages.length - 1));
      const imageData = allFrameImages[frameIdx];

      if (imageData) {
        const off = userOffscreenRef.current ?? (userOffscreenRef.current = document.createElement("canvas"));
        if (off.width !== imageData.width || off.height !== imageData.height) {
          off.width  = imageData.width;
          off.height = imageData.height;
        }
        off.getContext("2d")!.putImageData(imageData, 0, 0);
        ctx.drawImage(off, 0, 0, uW, uH);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, uW, uH);
      } else {
        ctx.fillStyle = "#171717";
        ctx.fillRect(0, 0, uW, uH);
      }

      const timeMs = pos * totalDurationMs;
      const poseFrame = nearestPoseFrame(userPoseFrames, timeMs);
      setActiveUserFrame(poseFrame);

      if (poseFrame) {
        const scale = { x: uW / poseFrame.frameWidth, y: uH / poseFrame.frameHeight };
        drawSkeleton(ctx, poseFrame.keypoints, "user", scale);
      }
    }

    // ── Reference canvas ─────────────────────────────────────────────────────
    const refCanvas = refCanvasRef.current;
    if (refCanvas) {
      const ctx = refCanvas.getContext("2d")!;
      refCanvas.width  = rW;
      refCanvas.height = rH;

      const refFrameIdx = Math.round(pos * (referenceData.totalFrames - 1));
      const refImages = refFrameImagesRef.current;

      if (refImages.length > 0 && refImages[refFrameIdx]) {
        const imageData = refImages[refFrameIdx];
        const off = refOffscreenRef.current ?? (refOffscreenRef.current = document.createElement("canvas"));
        if (off.width !== imageData.width || off.height !== imageData.height) {
          off.width  = imageData.width;
          off.height = imageData.height;
        }
        off.getContext("2d")!.putImageData(imageData, 0, 0);
        ctx.drawImage(off, 0, 0, rW, rH);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, rW, rH);
      } else {
        ctx.fillStyle = "#171717";
        ctx.fillRect(0, 0, rW, rH);
        ctx.fillStyle = "#525252";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Carregando referência…", rW / 2, rH / 2);
      }

      const refRawFrame = referenceData.frames[refFrameIdx];
      const srcW = referenceData.frameWidth  ?? 1080;
      const srcH = referenceData.frameHeight ?? 1920;
      const refPoseFrame = refRawFrame
        ? refFrameToPoseFrame(refRawFrame, srcW, srcH, rW, rH)
        : null;

      if (refPoseFrame) {
        const scale = { x: rW / refPoseFrame.frameWidth, y: rH / refPoseFrame.frameHeight };
        drawSkeleton(ctx, refPoseFrame.keypoints, "reference", scale);
      }
    }
  }, [userPoseFrames, referenceData, videoAspect, refAspect, allFrameImages, totalDurationMs]);

  const scheduleDrawAll = useCallback((pos: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawAll(pos);
    });
  }, [drawAll]);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const refVideo = refVideoRef.current;
    if (!refVideo) return;
    const onMeta = () => setRefAspect({ w: refVideo.videoWidth, h: refVideo.videoHeight });
    refVideo.addEventListener("loadedmetadata", onMeta, { once: true });
    if (refVideo.readyState >= 1) onMeta();
    return () => refVideo.removeEventListener("loadedmetadata", onMeta);
  }, []);

  useEffect(() => {
    if (allFrameImages.length > 0) scheduleDrawAll(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFrameImages]);

  // ── Extract reference frames ──────────────────────────────────────────────

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
      const duration = video.duration;
      const extractW = 640;
      const extractH = Math.round(640 * (video.videoHeight / Math.max(video.videoWidth, 1)));

      const canvas = document.createElement("canvas");
      canvas.width  = extractW;
      canvas.height = extractH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const images: ImageData[] = [];

      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) return;
        const t = (i / Math.max(totalFrames - 1, 1)) * duration;
        if (Math.abs(video.currentTime - t) > 0.001) {
          await new Promise<void>(resolve => {
            video.addEventListener("seeked", () => resolve(), { once: true });
            video.currentTime = t;
          });
        }
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

  useEffect(() => {
    if (refReady) scheduleDrawAll(scrubPosRef.current);
  }, [refReady, scheduleDrawAll]);

  // ── Scrubber ──────────────────────────────────────────────────────────────

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value);
    scrubPosRef.current = pos;
    setScrubPos(pos);
    scheduleDrawAll(pos);
  };

  // ── Time display ──────────────────────────────────────────────────────────

  const userDuration = totalDurationMs / 1000;
  const currentTimeS = scrubPos * userDuration;
  const formatTime = (s: number) => {
    const m   = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, "0");
    return `${m}:${sec}`;
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Side-by-side canvases */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-neutral-400 text-center">Seu Ollie</span>
          <div
            className="relative w-full border-2 border-red-500 rounded-lg overflow-hidden bg-neutral-900"
            style={{ aspectRatio: `${videoAspect.w} / ${videoAspect.h}` }}
          >
            <canvas ref={userCanvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-neutral-400 text-center">
            Referência Pro{!refReady && <span className="ml-1 text-neutral-600">(carregando…)</span>}
          </span>
          <div
            className="relative w-full border-2 border-green-500 rounded-lg overflow-hidden bg-neutral-900"
            style={{ aspectRatio: `${refAspect.w} / ${refAspect.h}` }}
          >
            <canvas ref={refCanvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>

      {/* Hidden reference video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={refVideoRef} src="/reference/ollie-reference.mp4" preload="auto" muted playsInline className="hidden" />

      {/* Scrubber */}
      <div className="w-full flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500 w-12 text-right font-mono">
            {formatTime(currentTimeS)}
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={scrubPos}
            onChange={handleScrubChange}
            className="flex-1 h-4 rounded-full appearance-none bg-neutral-700 cursor-pointer accent-red-500"
          />
          <span className="text-xs text-neutral-500 w-12 font-mono">
            {formatTime(userDuration)}
          </span>
        </div>
        <p className="text-xs text-neutral-500 text-center">
          Arraste para comparar frame a frame
        </p>
      </div>

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
