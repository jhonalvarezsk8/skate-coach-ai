// Feature extraction for DTW alignment.
// Produces a compact feature vector per frame that captures the shape of the
// movement regardless of body size or camera distance.
//
// Features (all normalized 0..1):
//   [0] hipY       — vertical position of hip center relative to frame height
//   [1] kneeAngle  — average knee flexion angle / 180°
//   [2] ankleYDiff — vertical separation between ankles / frame height

import type { PoseFrame, ReferenceFrameData } from "@/types";

// BlazePose 33 indices used
const L_HIP    = 23;
const R_HIP    = 24;
const L_KNEE   = 25;
const R_KNEE   = 26;
const L_ANKLE  = 27;
const R_ANKLE  = 28;

export type FeatureVec = [number, number, number];

function angleDeg(
  ax: number, ay: number,
  vx: number, vy: number,
  bx: number, by: number,
): number {
  const dax = ax - vx, day = ay - vy;
  const dbx = bx - vx, dby = by - vy;
  const dot = dax * dbx + day * dby;
  const mag = Math.hypot(dax, day) * Math.hypot(dbx, dby);
  if (mag === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

/** Extract feature vector from a user PoseFrame (keypoints already in pixel coords). */
export function featureFromPoseFrame(
  frame: PoseFrame,
  minVis = 0.3,
): FeatureVec | null {
  const kps = frame.keypoints;
  const fh  = frame.frameHeight;
  if (!kps || kps.length < 29 || fh === 0) return null;

  const lh = kps[L_HIP],  rh = kps[R_HIP];
  const lk = kps[L_KNEE], rk = kps[R_KNEE];
  const la = kps[L_ANKLE],ra = kps[R_ANKLE];

  const hipPts = [lh, rh].filter(k => k && k.visibility >= minVis);
  if (hipPts.length === 0) return null;
  const hipY = hipPts.reduce((s, k) => s + k.y, 0) / hipPts.length / fh;

  const angles: number[] = [];
  if (lh?.visibility >= minVis && lk?.visibility >= minVis && la?.visibility >= minVis)
    angles.push(angleDeg(lh.x, lh.y, lk.x, lk.y, la.x, la.y));
  if (rh?.visibility >= minVis && rk?.visibility >= minVis && ra?.visibility >= minVis)
    angles.push(angleDeg(rh.x, rh.y, rk.x, rk.y, ra.x, ra.y));
  const kneeAngle = angles.length > 0
    ? angles.reduce((s, a) => s + a, 0) / angles.length
    : 170;

  const ankleDiff =
    la?.visibility >= minVis && ra?.visibility >= minVis
      ? Math.abs(la.y - ra.y) / fh
      : 0;

  return [hipY, kneeAngle / 180, ankleDiff];
}

/** Extract feature vector from a reference JSON frame. */
export function featureFromRefFrame(
  frame: ReferenceFrameData,
  frameHeight: number,
  minConf = 0.3,
): FeatureVec | null {
  const kps  = frame.keypoints;
  const conf = frame.confidence;
  if (!kps || kps.length < 29 || frameHeight === 0) return null;

  const get = (idx: number) => {
    const c = conf[idx] ?? 0;
    if (c < minConf) return null;
    return { x: kps[idx][0], y: kps[idx][1], c };
  };

  const lh = get(L_HIP),  rh = get(R_HIP);
  const lk = get(L_KNEE), rk = get(R_KNEE);
  const la = get(L_ANKLE),ra = get(R_ANKLE);

  const hipPts = [lh, rh].filter(Boolean) as { x: number; y: number }[];
  if (hipPts.length === 0) return null;
  const hipY = hipPts.reduce((s, k) => s + k.y, 0) / hipPts.length / frameHeight;

  const angles: number[] = [];
  if (lh && lk && la) angles.push(angleDeg(lh.x, lh.y, lk.x, lk.y, la.x, la.y));
  if (rh && rk && ra) angles.push(angleDeg(rh.x, rh.y, rk.x, rk.y, ra.x, ra.y));
  const kneeAngle = angles.length > 0
    ? angles.reduce((s, a) => s + a, 0) / angles.length
    : 170;

  const ankleDiff = la && ra ? Math.abs(la.y - ra.y) / frameHeight : 0;

  return [hipY, kneeAngle / 180, ankleDiff];
}

/** Replace nulls with the nearest valid feature (forward then backward fill). */
export function fillNulls(features: (FeatureVec | null)[]): FeatureVec[] {
  const zero: FeatureVec = [0.5, 170 / 180, 0];
  const result: FeatureVec[] = features.map(f => f ?? zero);

  // Forward fill
  let last = zero;
  for (let i = 0; i < result.length; i++) {
    if (features[i] !== null) { last = result[i]; }
    else { result[i] = last; }
  }
  // Backward fill (fix leading nulls)
  let next = zero;
  for (let i = result.length - 1; i >= 0; i--) {
    if (features[i] !== null) { next = result[i]; }
    else { result[i] = next; }
  }
  return result;
}
