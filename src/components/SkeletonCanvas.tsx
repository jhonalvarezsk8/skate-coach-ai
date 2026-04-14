"use client";

import { useEffect, useRef } from "react";
import type { Keypoint } from "@/types";
import { drawSkeleton, drawBoard, drawDarkenedFrame } from "@/lib/skeleton/skeletonRenderer";
import { estimateBoardKeypoints } from "@/lib/skeleton/boardEstimator";

interface Props {
  imageData: ImageData | null;
  keypoints: Keypoint[] | null;
  color: "user" | "reference";
  width: number;
  height: number;
  label: string;
}

export default function SkeletonCanvas({
  imageData,
  keypoints,
  color,
  width,
  height,
  label,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (imageData) {
      drawDarkenedFrame(ctx, imageData, width, height);
    } else {
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, width, height);
    }

    if (keypoints && keypoints.length >= 17) {
      drawSkeleton(ctx, keypoints, color);

      const board = estimateBoardKeypoints(keypoints);
      if (board) {
        drawBoard(ctx, board.nose, board.tail);
      }
    }
  }, [imageData, keypoints, color, width, height]);

  const borderColor = color === "user" ? "border-red-600" : "border-green-600";
  const labelColor  = color === "user" ? "text-red-400"   : "text-green-400";

  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`text-sm font-medium ${labelColor}`}>{label}</span>
      <div className={`relative border-2 ${borderColor} rounded-lg overflow-hidden`}
           style={{ width, height }}>
        <canvas ref={canvasRef} width={width} height={height} />
      </div>
    </div>
  );
}
