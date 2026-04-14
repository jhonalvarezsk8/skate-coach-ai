import type { PoseFrame, Keypoint } from "@/types";

/**
 * Applies temporal smoothing to a sequence of PoseFrames.
 *
 * For each keypoint in each frame, computes a visibility-weighted average of
 * neighbouring frames within the window. This removes single-frame detection
 * glitches (keypoint suddenly jumps then corrects) without blurring genuine
 * fast motion.
 *
 * @param frames   Raw poseFrames from the inference worker
 * @param window   Number of frames to look ahead/behind (default 2 → 5-frame window)
 * @param minVis   Minimum visibility threshold to include a neighbour's contribution
 */
export function smoothPoseFrames(
  frames: PoseFrame[],
  window = 2,
  minVis = 0.25,
): PoseFrame[] {
  if (frames.length < 3) return frames;

  return frames.map((frame, i) => {
    const smoothedKeypoints: Keypoint[] = frame.keypoints.map((kp, kpIdx) => {
      // Collect neighbour keypoints within the window that pass the visibility threshold
      let sumX = 0, sumY = 0, sumW = 0;

      for (let j = Math.max(0, i - window); j <= Math.min(frames.length - 1, i + window); j++) {
        const nkp = frames[j].keypoints[kpIdx];
        if (!nkp || nkp.visibility < minVis) continue;
        const w = nkp.visibility;
        sumX += nkp.x * w;
        sumY += nkp.y * w;
        sumW += w;
      }

      if (sumW === 0) return kp; // no valid neighbours — keep original

      return {
        x: sumX / sumW,
        y: sumY / sumW,
        visibility: kp.visibility, // keep original confidence for rendering decisions
      };
    });

    return { ...frame, keypoints: smoothedKeypoints };
  });
}
