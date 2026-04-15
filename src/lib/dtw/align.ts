// align.ts — ties together motion detection, feature extraction and DTW.
// Called from ComparisonView (main thread) once both user pose frames and
// reference data are available.  Runs synchronously; for video sizes used
// here (≤ 200 × 90 frames) the whole pipeline completes in < 5 ms.

import type { PoseFrame, ReferenceData } from "@/types";
import { detectMotionSegment } from "./motionDetector";
import { featureFromPoseFrame, featureFromRefFrame, fillNulls } from "./featureExtractor";
import { computeDTWAlignment } from "./dtw";

export interface AlignmentResult {
  /** For each reference frame index, the corresponding absolute user frame index. */
  alignmentMap:     number[];
  /** Where the detected motion segment starts in the user video (absolute frame index). */
  userSegmentStart: number;
  /** Where the detected motion segment ends in the user video (absolute frame index). */
  userSegmentEnd:   number;
}

/**
 * Aligns a user video (represented as PoseFrame[]) to a reference video
 * (ReferenceData) using motion detection + DTW over pose features.
 *
 * Returns null if there is insufficient data to compute an alignment.
 */
export function alignUserToReference(
  userFrames:    PoseFrame[],
  referenceData: ReferenceData,
): AlignmentResult | null {
  const refFrames = referenceData.frames;
  const refH      = referenceData.frameHeight ?? 1920;

  if (userFrames.length < 5 || refFrames.length < 5) return null;

  // ── 1. Detect the active motion segment in the user video ─────────────────
  const { start, end } = detectMotionSegment(userFrames);
  const userSegment    = userFrames.slice(start, end + 1);

  if (userSegment.length < 3) return null;

  // ── 2. Extract feature vectors ────────────────────────────────────────────
  const userRaw = userSegment.map(f => featureFromPoseFrame(f));
  const refRaw  = refFrames.map(f => featureFromRefFrame(f, refH));

  const userFeatures = fillNulls(userRaw);
  const refFeatures  = fillNulls(refRaw);

  // ── 3. Run DTW ────────────────────────────────────────────────────────────
  // segmentMap[refFrameIdx] = index within userSegment
  const segmentMap = computeDTWAlignment(refFeatures, userFeatures);
  if (segmentMap.length === 0) return null;

  // ── 4. Convert segment indices → absolute user frame indices ─────────────
  const alignmentMap = segmentMap.map(segIdx => start + segIdx);

  return { alignmentMap, userSegmentStart: start, userSegmentEnd: end };
}
