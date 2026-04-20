import type { Keypoint } from "@/types";
import { SKELETON_CONNECTIONS } from "@/types";

export type SkeletonColor = "user" | "reference";

const COLORS: Record<SkeletonColor, { joint: string; bone: string }> = {
  user:      { joint: "#ef4444", bone: "rgba(239,68,68,0.8)" },
  reference: { joint: "#22c55e", bone: "rgba(34,197,94,0.8)" },
};

const JOINT_RADIUS = 5;
const BONE_WIDTH = 2;
const BOARD_COLOR = "rgba(234, 179, 8, 0.85)";
const BOARD_LINE_WIDTH = 3;
const BOARD_RADIUS = 6;
// Minimum visibility to render a joint/bone. Higher = stricter: hides occluded
// keypoints where MediaPipe guesses poorly (e.g. arm behind torso during rotation).
const MIN_VISIBILITY = 0.5;

export function drawSkeleton(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  keypoints: Keypoint[],
  color: SkeletonColor,
  scale: { x: number; y: number } = { x: 1, y: 1 },
  sizeScale: number = 1,
): void {
  const { joint, bone } = COLORS[color];
  const jointRadius = Math.max(1, JOINT_RADIUS * sizeScale);
  const boneWidth   = Math.max(0.5, BONE_WIDTH * sizeScale);

  // Draw bones (connections)
  ctx.strokeStyle = bone;
  ctx.lineWidth = boneWidth;
  ctx.lineCap = "round";

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const kpA = keypoints[a];
    const kpB = keypoints[b];
    if (!kpA || !kpB || kpA.visibility < MIN_VISIBILITY || kpB.visibility < MIN_VISIBILITY) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(kpA.x * scale.x, kpA.y * scale.y);
    ctx.lineTo(kpB.x * scale.x, kpB.y * scale.y);
    ctx.stroke();
  }

  // Draw joints (skip face 0-10, pinky 17-18, thumb 21-22)
  const SKIP_JOINTS = new Set([0,1,2,3,4,5,6,7,8,9,10,17,18,21,22]);
  for (let i = 0; i < keypoints.length; i++) {
    if (SKIP_JOINTS.has(i)) continue;
    const kp = keypoints[i];
    if (!kp || kp.visibility < MIN_VISIBILITY) continue;

    ctx.fillStyle = joint;
    ctx.beginPath();
    ctx.arc(kp.x * scale.x, kp.y * scale.y, jointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBoard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  nose: { x: number; y: number },
  tail: { x: number; y: number },
  scale: { x: number; y: number } = { x: 1, y: 1 }
): void {
  ctx.strokeStyle = BOARD_COLOR;
  ctx.lineWidth = BOARD_LINE_WIDTH;
  ctx.lineCap = "round";

  const nx = nose.x * scale.x;
  const ny = nose.y * scale.y;
  const tx = tail.x * scale.x;
  const ty = tail.y * scale.y;

  // Draw board axis
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Draw nose circle
  ctx.fillStyle = BOARD_COLOR;
  ctx.beginPath();
  ctx.arc(nx, ny, BOARD_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Draw tail circle (slightly larger)
  ctx.beginPath();
  ctx.arc(tx, ty, BOARD_RADIUS * 1.2, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a darkened frame background (original image at reduced opacity)
export function drawDarkenedFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  imageData: ImageData,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Put the image first, then darken with a semi-transparent overlay
  ctx.putImageData(imageData, 0, 0);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}
