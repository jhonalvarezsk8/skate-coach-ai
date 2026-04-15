// Detects the active motion segment in a user video.
// Uses joint velocity of hips/knees/ankles (normalized by frame size) to find
// the first and last frames where sustained movement occurs, then adds padding.

import type { PoseFrame } from "@/types";

const KEY_JOINTS = [23, 24, 25, 26, 27, 28]; // hips, knees, ankles

function jointVelocity(frames: PoseFrame[], i: number, minVis = 0.3): number {
  if (i === 0) return 0;
  const prev = frames[i - 1];
  const curr = frames[i];
  const fw = curr.frameWidth  || 640;
  const fh = curr.frameHeight || 640;
  let total = 0, count = 0;

  for (const idx of KEY_JOINTS) {
    const p = prev.keypoints[idx];
    const c = curr.keypoints[idx];
    if (p && c && p.visibility >= minVis && c.visibility >= minVis) {
      const dx = (c.x - p.x) / fw;
      const dy = (c.y - p.y) / fh;
      total += Math.sqrt(dx * dx + dy * dy);
      count++;
    }
  }

  return count > 0 ? total / count : 0;
}

function movingAverage(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end   = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

export interface MotionSegment {
  start: number;
  end:   number;
}

/**
 * Returns the frame range [start, end] (inclusive) where significant movement
 * is detected. Falls back to the full video if nothing is found.
 *
 * @param threshold  Normalised velocity per joint above which a frame is "moving"
 * @param minConsec  Minimum consecutive active frames to confirm motion start/end
 * @param padding    Extra frames to include before/after the detected segment
 */
export function detectMotionSegment(
  frames: PoseFrame[],
  threshold   = 0.004,
  minConsec   = 3,
  padding     = 12,
): MotionSegment {
  const n = frames.length;
  if (n < minConsec * 2) return { start: 0, end: n - 1 };

  const velocities = frames.map((_, i) => jointVelocity(frames, i));
  const smoothed   = movingAverage(velocities, 7);

  let start = 0;
  let end   = n - 1;

  // First run of minConsec frames all above threshold → motion start
  outer:
  for (let i = 0; i <= n - minConsec; i++) {
    for (let j = 0; j < minConsec; j++) {
      if (smoothed[i + j] < threshold) continue outer;
    }
    start = Math.max(0, i - padding);
    break;
  }

  // Last run of minConsec frames all above threshold → motion end
  outer2:
  for (let i = n - 1; i >= minConsec - 1; i--) {
    for (let j = 0; j < minConsec; j++) {
      if (smoothed[i - j] < threshold) continue outer2;
    }
    end = Math.min(n - 1, i + padding);
    break;
  }

  if (start >= end) return { start: 0, end: n - 1 };
  return { start, end };
}
