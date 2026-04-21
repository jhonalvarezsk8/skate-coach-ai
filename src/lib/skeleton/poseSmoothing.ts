import type { PoseFrame, Keypoint } from "@/types";

// Post-processing pipeline for user pose frames.
// Runs on the main thread after the worker returns the raw detections.
//
// Pipeline:
//   1. fillGaps            — interpolates missing/low-confidence keypoints
//                             from neighbors, so the skeleton doesn't disappear
//                             in frames where MediaPipe failed to detect.
//   2. rejectOutliers      — replaces keypoints that jumped far from the
//                             interpolated position (single-frame glitches).
//   3. smoothPoseFrames    — velocity-adaptive temporal smoothing.

export interface ProcessOptions {
  fillVisibilityThreshold?: number;  // below this → treat as missing
  fillMaxGap?: number;               // max gap (in frames) to interpolate across
  fillVisibility?: number;           // visibility assigned to interpolated keypoints
  outlierMinPixels?: number;         // minimum deviation in px to flag as outlier
  outlierFactor?: number;            // deviation must exceed median × factor
  outlierMinVisibility?: number;     // only evaluate when neighbors meet this
  smoothMaxWin?: number;             // max half-window for smoothing
  smoothMinVis?: number;             // min visibility for neighbors in smoothing
}

export function processPoseFrames(
  frames: PoseFrame[],
  opts: ProcessOptions = {},
): PoseFrame[] {
  const {
    smoothMaxWin = 2,
    smoothMinVis = 0.25,
  } = opts;

  // Match the reference pipeline exactly: only velocity-adaptive temporal smoothing.
  // fillGaps and rejectOutliers remain exported for ad-hoc use but are off by default.
  return smoothPoseFrames(frames, smoothMaxWin, smoothMinVis);
}

// ─── Step 1: fill gaps via Catmull-Rom (with linear fallback) ───────────────
//
// For each keypoint series, finds runs of frames where visibility is below
// threshold. If valid frames exist on both sides AND the gap is ≤ maxGap,
// interpolates position along the joint's trajectory and stamps a synthetic
// visibility above the renderer's 0.5 gate so the skeleton stays drawn.
//
// Strategy:
//   - If 2 valid points exist on each side (i-2, i-1, end, end+1): use
//     Catmull-Rom spline → curves match the joint's actual motion through
//     the gap, avoiding the "kinked line" artifact of linear interpolation.
//   - Otherwise: fall back to linear interpolation between the two boundary
//     anchors. Fall back to "no fill" only if we lack valid anchors entirely.
export function fillGaps(
  frames: PoseFrame[],
  minVis: number,
  maxGap: number,
  fillVis: number,
): PoseFrame[] {
  const n = frames.length;
  if (n < 3) return frames;
  const kpCount = frames[0].keypoints.length;

  const out = cloneFrames(frames);

  for (let k = 0; k < kpCount; k++) {
    let i = 0;
    while (i < n) {
      if (out[i].keypoints[k].visibility >= minVis) { i++; continue; }

      let end = i;
      while (end < n && out[end].keypoints[k].visibility < minVis) end++;

      const gapSize = end - i;
      const prevIdx = i - 1;
      const nextIdx = end;

      if (prevIdx >= 0 && nextIdx < n && gapSize <= maxGap) {
        const p1 = out[prevIdx].keypoints[k];
        const p2 = out[nextIdx].keypoints[k];

        // Look for extra anchor points for Catmull-Rom (skip frames whose
        // visibility for this keypoint is below the anchor threshold)
        const p0 = findValidAnchor(out, prevIdx - 1, -1, k, minVis) ?? p1;
        const p3 = findValidAnchor(out, nextIdx + 1, +1, k, minVis) ?? p2;
        const useSpline = p0 !== p1 && p3 !== p2;

        for (let j = i; j < end; j++) {
          const t = (j - prevIdx) / (nextIdx - prevIdx);
          const pos = useSpline
            ? catmullRom(p0, p1, p2, p3, t)
            : { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
          out[j].keypoints[k] = { x: pos.x, y: pos.y, visibility: fillVis };
        }
      }

      i = end;
    }
  }

  return out;
}

// Walk frames in `direction` from `startIdx` looking for a keypoint whose
// visibility meets `minVis`. Returns null if none found within 5 steps.
function findValidAnchor(
  frames: PoseFrame[],
  startIdx: number,
  direction: number,
  k: number,
  minVis: number,
): { x: number; y: number } | null {
  let idx = startIdx;
  for (let steps = 0; steps < 5; steps++) {
    if (idx < 0 || idx >= frames.length) return null;
    const kp = frames[idx].keypoints[k];
    if (kp && kp.visibility >= minVis) return { x: kp.x, y: kp.y };
    idx += direction;
  }
  return null;
}

// Catmull-Rom spline interpolation between p1 and p2, using p0 and p3 to
// define the entry and exit tangents (uniform parametrization).
function catmullRom(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );
  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );
  return { x, y };
}

// ─── Step 2: reject single-frame outliers ───────────────────────────────────
//
// For each keypoint series, computes the deviation of each middle frame from
// the midpoint of its neighbors. If deviation exceeds max(minPixels, factor ×
// median deviation), replaces the frame's position with the interpolated one.
// Preserves the original visibility so the renderer's gate still applies.
export function rejectOutliers(
  frames: PoseFrame[],
  minPixels: number,
  factor: number,
  minVis: number,
): PoseFrame[] {
  const n = frames.length;
  if (n < 3) return frames;
  const kpCount = frames[0].keypoints.length;

  const out = cloneFrames(frames);

  for (let k = 0; k < kpCount; k++) {
    const deviations: number[] = [];
    const validIdx: boolean[] = [];
    for (let i = 1; i < n - 1; i++) {
      const prev = out[i - 1].keypoints[k];
      const cur  = out[i].keypoints[k];
      const next = out[i + 1].keypoints[k];
      const valid =
        prev.visibility >= minVis &&
        cur.visibility  >= minVis &&
        next.visibility >= minVis;
      validIdx.push(valid);
      if (!valid) { deviations.push(0); continue; }
      const expX = (prev.x + next.x) / 2;
      const expY = (prev.y + next.y) / 2;
      deviations.push(Math.hypot(cur.x - expX, cur.y - expY));
    }

    const nonZero = deviations.filter(d => d > 0).sort((a, b) => a - b);
    const median = nonZero.length > 0 ? nonZero[Math.floor(nonZero.length / 2)] : 0;
    const threshold = Math.max(minPixels, median * factor);

    for (let i = 1; i < n - 1; i++) {
      const di = i - 1;
      if (!validIdx[di] || deviations[di] <= threshold) continue;
      const prev = out[i - 1].keypoints[k];
      const next = out[i + 1].keypoints[k];
      out[i].keypoints[k] = {
        x: (prev.x + next.x) / 2,
        y: (prev.y + next.y) / 2,
        visibility: out[i].keypoints[k].visibility,
      };
    }
  }

  return out;
}

// ─── Step 3: velocity-adaptive temporal smoothing ───────────────────────────
//
// Mirrors the algorithm in src/lib/reference/referenceLoader.ts but operates
// on PoseFrame[] (Keypoint { x, y, visibility }) instead of the reference's
// parallel-array format. Fast-moving joints use a smaller window (or none) to
// avoid lag at high-velocity moments like the pop.
export function smoothPoseFrames(
  frames: PoseFrame[],
  maxWin = 2,
  minVis = 0.25,
): PoseFrame[] {
  const n = frames.length;
  if (n < 3) return frames;

  return frames.map((frame, i) => {
    const kpCount = frame.keypoints.length;
    const smoothedKps: Keypoint[] = [];

    for (let k = 0; k < kpCount; k++) {
      const win = adaptiveWindow(frames, i, k, maxWin, minVis);

      let sumX = 0, sumY = 0, sumW = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
        const kp = frames[j].keypoints[k];
        if (!kp) continue;
        const vis = kp.visibility;
        if (vis < minVis) continue;
        sumX += kp.x * vis;
        sumY += kp.y * vis;
        sumW += vis;
      }

      const original = frame.keypoints[k];
      if (sumW === 0) {
        smoothedKps.push(original);
      } else {
        smoothedKps.push({
          x: sumX / sumW,
          y: sumY / sumW,
          visibility: original.visibility,
        });
      }
    }

    return { ...frame, keypoints: smoothedKps };
  });
}

function adaptiveWindow(
  frames: PoseFrame[],
  i: number,
  kpIdx: number,
  maxWin: number,
  minVis: number,
): number {
  if (i === 0 || i === frames.length - 1) return maxWin;
  const prev = frames[i - 1].keypoints[kpIdx];
  const next = frames[i + 1].keypoints[kpIdx];
  if (!prev || !next) return maxWin;
  if (prev.visibility < minVis || next.visibility < minVis) return maxWin;

  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const velocity = Math.sqrt(dx * dx + dy * dy) / 2;

  if (velocity > 15) return 0;
  if (velocity > 5) return 1;
  return maxWin;
}

function cloneFrames(frames: PoseFrame[]): PoseFrame[] {
  return frames.map(f => ({
    ...f,
    keypoints: f.keypoints.map(kp => ({ ...kp })),
  }));
}
