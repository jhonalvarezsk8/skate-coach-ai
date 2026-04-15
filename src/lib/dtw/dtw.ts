// Classic Dynamic Time Warping (DTW) over sequences of feature vectors.
// For the video sizes used here (≤ 200 × 90 frames) this runs in < 2 ms.

import type { FeatureVec } from "./featureExtractor";

function euclidean(a: FeatureVec, b: FeatureVec): number {
  let sum = 0;
  for (let k = 0; k < a.length; k++) {
    const d = a[k] - b[k];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Runs DTW between two feature sequences and returns an alignment map:
 *   alignmentMap[i] = j  →  refSeq[i] best aligns to userSeq[j]
 *
 * @param refSeq   Feature sequence for the reference video (length N)
 * @param userSeq  Feature sequence for the user video segment (length M)
 * @returns        number[] of length N — each value is in [0, M-1]
 */
export function computeDTWAlignment(
  refSeq:  FeatureVec[],
  userSeq: FeatureVec[],
): number[] {
  const n = refSeq.length;
  const m = userSeq.length;

  if (n === 0 || m === 0) return [];

  // ── Build cost matrix ─────────────────────────────────────────────────────
  // Use flat Float64Array for performance (no jagged-array allocation)
  const INF = 1e9;
  const dp  = new Float64Array(n * m).fill(INF);

  const at = (i: number, j: number) => i * m + j;

  dp[at(0, 0)] = euclidean(refSeq[0], userSeq[0]);

  for (let i = 1; i < n; i++) dp[at(i, 0)] = dp[at(i - 1, 0)] + euclidean(refSeq[i], userSeq[0]);
  for (let j = 1; j < m; j++) dp[at(0, j)] = dp[at(0, j - 1)] + euclidean(refSeq[0], userSeq[j]);

  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      dp[at(i, j)] =
        euclidean(refSeq[i], userSeq[j]) +
        Math.min(dp[at(i - 1, j - 1)], dp[at(i - 1, j)], dp[at(i, j - 1)]);
    }
  }

  // ── Traceback ─────────────────────────────────────────────────────────────
  // Collect [refIdx, userIdx] pairs from [n-1, m-1] → [0, 0]
  const path: [number, number][] = [];
  let i = n - 1, j = m - 1;

  while (i > 0 || j > 0) {
    path.push([i, j]);
    if (i === 0)      { j--; }
    else if (j === 0) { i--; }
    else {
      const diag  = dp[at(i - 1, j - 1)];
      const left  = dp[at(i - 1, j)];
      const down  = dp[at(i, j - 1)];
      const best  = Math.min(diag, left, down);
      if      (best === diag) { i--; j--; }
      else if (best === left) { i--; }
      else                    { j--; }
    }
  }
  path.push([0, 0]);
  path.reverse();

  // ── Build alignmentMap ────────────────────────────────────────────────────
  // For each reference frame, collect all user frames it was paired with,
  // then take the average (handles many-to-one and one-to-many stretches).
  const buckets: number[][] = Array.from({ length: n }, () => []);
  for (const [ri, ui] of path) buckets[ri].push(ui);

  const alignmentMap: number[] = new Array(n);
  for (let r = 0; r < n; r++) {
    const bucket = buckets[r];
    alignmentMap[r] = bucket.length > 0
      ? Math.round(bucket.reduce((s, v) => s + v, 0) / bucket.length)
      : r < alignmentMap.length - 1 ? alignmentMap[r - 1] ?? 0 : m - 1;
  }

  return alignmentMap;
}
