import type { PoseFrame, PhaseMap } from "@/types";
import { PHASE_THRESHOLDS } from "./phaseTypes";

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function angleDeg(
  a: { x: number; y: number },
  vertex: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const ax = a.x - vertex.x;
  const ay = a.y - vertex.y;
  const bx = b.x - vertex.x;
  const by = b.y - vertex.y;
  const dot = ax * bx + ay * by;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA === 0 || magB === 0) return 180;
  return (Math.acos(Math.min(1, Math.max(-1, dot / (magA * magB)))) * 180) / Math.PI;
}

// ─── Smoothing ────────────────────────────────────────────────────────────────

function movingAverage(values: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(values.length, start + windowSize);
    const slice = values.slice(start, end);
    result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return result;
}

// ─── Derivative helpers ───────────────────────────────────────────────────────

function velocity(values: number[], i: number): number {
  if (i === 0) return 0;
  return values[i] - values[i - 1];
}

function acceleration(values: number[], i: number): number {
  if (i < 2) return 0;
  return velocity(values, i) - velocity(values, i - 1);
}

// ─── Phase extraction ─────────────────────────────────────────────────────────

export function detectPhases(frames: PoseFrame[]): PhaseMap {
  if (frames.length < 5) {
    return temporalFallback(frames.length);
  }

  const n = frames.length;
  const {
    KNEE_BEND_DEGREES,
    SETUP_MIN_FRAMES,
    ACC_POP_THRESHOLD,
    ANKLE_DIFF_RATIO,
    ANKLE_LEVEL_RATIO,
    ACC_LAND_THRESHOLD,
    SMOOTHING_WINDOW,
  } = PHASE_THRESHOLDS;

  // ── Extract raw signal arrays ──────────────────────────────────────────────
  const hipYRaw = frames.map((f) => {
    const lh = f.keypoints[23]; // left_hip (BlazePose)
    const rh = f.keypoints[24]; // right_hip (BlazePose)
    if (!lh || !rh) return -1;
    if (lh.visibility < 0.3 && rh.visibility < 0.3) return -1;
    if (lh.visibility < 0.3) return rh.y;
    if (rh.visibility < 0.3) return lh.y;
    return (lh.y + rh.y) / 2;
  });

  const kneeAnglesRaw = frames.map((f) => {
    // Average of left and right knee angles (BlazePose indices)
    const lhip = f.keypoints[23];
    const lknee = f.keypoints[25];
    const lankle = f.keypoints[27];
    const rhip = f.keypoints[24];
    const rknee = f.keypoints[26];
    const rankle = f.keypoints[28];

    const angles: number[] = [];
    if (lhip && lknee && lankle && lhip.visibility > 0.3 && lknee.visibility > 0.3 && lankle.visibility > 0.3) {
      angles.push(angleDeg(lhip, lknee, lankle));
    }
    if (rhip && rknee && rankle && rhip.visibility > 0.3 && rknee.visibility > 0.3 && rankle.visibility > 0.3) {
      angles.push(angleDeg(rhip, rknee, rankle));
    }
    return angles.length > 0 ? angles.reduce((s, a) => s + a, 0) / angles.length : 170;
  });

  const ankleDiffRaw = frames.map((f) => {
    const la = f.keypoints[27]; // left_ankle (BlazePose)
    const ra = f.keypoints[28]; // right_ankle (BlazePose)
    if (!la || !ra || la.visibility < 0.3 || ra.visibility < 0.3) return 0;
    return la.y - ra.y; // positive when left ankle is lower
  });

  // ── Smooth signals ────────────────────────────────────────────────────────
  const hipY = movingAverage(hipYRaw.map(v => v < 0 ? 0 : v), SMOOTHING_WINDOW);
  const kneeAngles = movingAverage(kneeAnglesRaw, SMOOTHING_WINDOW);
  const ankleDiff = movingAverage(ankleDiffRaw, SMOOTHING_WINDOW);

  const frameH = frames[0]?.frameHeight ?? 640;
  const ankleDiffThreshold = ANKLE_DIFF_RATIO * frameH;
  const ankleLevelThreshold = ANKLE_LEVEL_RATIO * frameH;

  // ── SETUP: first frame where knees bend below threshold for N frames ───────
  let setup = -1;
  for (let i = 0; i <= n - SETUP_MIN_FRAMES; i++) {
    let count = 0;
    for (let j = i; j < i + SETUP_MIN_FRAMES; j++) {
      if (kneeAngles[j] < KNEE_BEND_DEGREES) count++;
    }
    if (count >= SETUP_MIN_FRAMES) {
      setup = i;
      break;
    }
  }
  if (setup < 0) setup = 0;

  // ── POP: local minimum of hipY after setup (deepest crouch) ──────────────
  let pop = -1;
  // Find the frame with strongest upward acceleration after setup
  let maxUpAcc = 0;
  for (let i = setup + 2; i < n - 1; i++) {
    const acc = acceleration(hipY, i);
    if (acc < ACC_POP_THRESHOLD && acc < maxUpAcc) {
      maxUpAcc = acc;
      pop = i;
    }
  }
  // Fallback: global minimum of hipY after setup
  if (pop < 0) {
    let maxHip = -Infinity;
    for (let i = setup; i < n; i++) {
      if (hipY[i] > maxHip) { maxHip = hipY[i]; pop = i; }
    }
  }
  if (pop < 0) pop = Math.floor(n * 0.25);

  // ── FLICK: maximum ankle difference after pop ─────────────────────────────
  let flick = -1;
  let maxDiff = 0;
  for (let i = pop; i < n; i++) {
    const diff = Math.abs(ankleDiff[i]);
    if (diff > ankleDiffThreshold && diff > maxDiff) {
      maxDiff = diff;
      flick = i;
    }
  }
  if (flick < 0) flick = Math.min(pop + Math.floor((n - pop) * 0.3), n - 1);

  // ── CATCH: minimum hipY (peak of jump) after flick + ankles level ─────────
  let catchFrame = -1;
  let minHip = Infinity;
  for (let i = flick; i < n; i++) {
    if (hipY[i] < minHip && Math.abs(ankleDiff[i]) < ankleLevelThreshold) {
      minHip = hipY[i];
      catchFrame = i;
    }
  }
  if (catchFrame < 0) {
    // Fallback: just find minimum hipY after flick
    for (let i = flick; i < n; i++) {
      if (hipY[i] < minHip) { minHip = hipY[i]; catchFrame = i; }
    }
  }
  if (catchFrame < 0) catchFrame = Math.min(flick + Math.floor((n - flick) * 0.4), n - 1);

  // ── LANDING: strong positive acceleration (impact) after catch ────────────
  let landing = -1;
  for (let i = catchFrame + 2; i < n; i++) {
    const acc = acceleration(hipY, i);
    if (acc > ACC_LAND_THRESHOLD) {
      landing = i;
      break;
    }
  }
  if (landing < 0) landing = Math.min(catchFrame + Math.floor((n - catchFrame) * 0.5), n - 1);

  // ── Ensure strict monotonic ordering ─────────────────────────────────────
  const ordered = ensureOrder([setup, pop, flick, catchFrame, landing], n);

  return {
    setup: ordered[0],
    pop: ordered[1],
    flick: ordered[2],
    catch: ordered[3],
    landing: ordered[4],
    usedFallback: false,
  };
}

// Ensures phases are strictly increasing and within bounds.
function ensureOrder(phases: number[], n: number): number[] {
  const result = [...phases];
  for (let i = 1; i < result.length; i++) {
    if (result[i] <= result[i - 1]) {
      result[i] = Math.min(result[i - 1] + 1, n - 1);
    }
  }
  return result;
}

// Temporal fallback: divide the video into 5 equal parts.
function temporalFallback(n: number): PhaseMap {
  const step = Math.max(1, Math.floor(n / 5));
  return {
    setup: 0,
    pop: step,
    flick: step * 2,
    catch: step * 3,
    landing: step * 4,
    usedFallback: true,
  };
}
