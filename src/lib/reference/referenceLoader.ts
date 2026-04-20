import type { ReferenceData, Keypoint, PoseFrame } from "@/types";

let _cached: ReferenceData | null = null;

export async function loadReferenceData(): Promise<ReferenceData> {
  if (_cached) return _cached;

  const res = await fetch("/reference/ollie-reference-kps.json");
  if (!res.ok) {
    throw new Error(`Failed to load reference data: ${res.status}`);
  }

  const data = await res.json() as ReferenceData;
  _cached = smoothReferenceData(data);
  return _cached;
}

// Velocity-adaptive temporal smoothing on raw reference keypoints.
// Mirrors the smoothPoseFrames logic but operates on the ReferenceFrameData format.
// Fast-moving joints get less smoothing to avoid lag; static joints get full smoothing.
function smoothReferenceData(data: ReferenceData, maxWin = 2, minVis = 0.25): ReferenceData {
  const frames = data.frames;
  const n = frames.length;
  if (n < 3) return data;

  const smoothed = frames.map((frame, i) => {
    if (!frame.keypoints) return frame;

    const kpCount = frame.keypoints.length;
    const smoothedKps: [number, number][] = [];
    const smoothedConf: number[] = [];

    for (let k = 0; k < kpCount; k++) {
      // Compute adaptive window based on velocity of this keypoint
      const win = refAdaptiveWindow(frames, i, k, maxWin, minVis);

      let sumX = 0, sumY = 0, sumW = 0;

      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
        const nf = frames[j];
        if (!nf.keypoints || !nf.keypoints[k]) continue;
        const vis = nf.confidence[k] ?? 0.9;
        if (vis < minVis) continue;
        sumX += nf.keypoints[k][0] * vis;
        sumY += nf.keypoints[k][1] * vis;
        sumW += vis;
      }

      if (sumW === 0) {
        smoothedKps.push(frame.keypoints[k]);
      } else {
        smoothedKps.push([sumX / sumW, sumY / sumW]);
      }
      smoothedConf.push(frame.confidence[k] ?? 0.9);
    }

    return { ...frame, keypoints: smoothedKps, confidence: smoothedConf };
  });

  return { ...data, frames: smoothed };
}

function refAdaptiveWindow(
  frames: ReferenceData["frames"], i: number, kpIdx: number, maxWin: number, minVis: number,
): number {
  if (i === 0 || i === frames.length - 1) return maxWin;
  const prev = frames[i - 1];
  const next = frames[i + 1];
  if (!prev?.keypoints?.[kpIdx] || !next?.keypoints?.[kpIdx]) return maxWin;
  const prevVis = prev.confidence[kpIdx] ?? 0.9;
  const nextVis = next.confidence[kpIdx] ?? 0.9;
  if (prevVis < minVis || nextVis < minVis) return maxWin;

  const dx = next.keypoints[kpIdx][0] - prev.keypoints[kpIdx][0];
  const dy = next.keypoints[kpIdx][1] - prev.keypoints[kpIdx][1];
  const velocity = Math.sqrt(dx * dx + dy * dy) / 2;

  if (velocity > 15) return 0;
  if (velocity > 5)  return 1;
  return maxWin;
}

// Convert a ReferenceFrameData entry to a PoseFrame for rendering.
// Scales keypoint coordinates from the source video dimensions to the canvas display size,
// applying the same letterbox math so proportions are preserved.
export function refFrameToPoseFrame(
  refFrame: ReferenceData["frames"][number],
  sourceWidth: number,   // original video width used during preprocessing
  sourceHeight: number,  // original video height used during preprocessing
  canvasWidth: number,   // display canvas width
  canvasHeight: number,  // display canvas height
): PoseFrame {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const offsetX = (canvasWidth - sourceWidth * scale) / 2;
  const offsetY = (canvasHeight - sourceHeight * scale) / 2;

  const keypoints: Keypoint[] = refFrame.keypoints.map(([x, y], i) => ({
    x: x * scale + offsetX,
    y: y * scale + offsetY,
    visibility: refFrame.confidence[i] ?? 0.9,
  }));

  // Pad to 33 if fewer keypoints present (e.g., older JSON with 17 COCO keypoints)
  while (keypoints.length < 33) {
    keypoints.push({ x: 0, y: 0, visibility: 0 });
  }

  return {
    frameIndex: refFrame.frame,
    timestampMs: 0,
    keypoints,
    detectionConf: 1,
    frameWidth: canvasWidth,
    frameHeight: canvasHeight,
  };
}
