import type { Keypoint, BoardKeypoints } from "@/types";

// Geometric heuristic: estimates board position from ankle keypoints.
// The board extends ~40% beyond the line between left and right ankles on each side.
// Left ankle = front foot in a regular stance; adjust BOARD_EXTEND_RATIO if needed.

const BOARD_EXTEND_RATIO = 0.4;

export function estimateBoardKeypoints(
  keypoints: Keypoint[]
): BoardKeypoints | null {
  const leftAnkle  = keypoints[27]; // left_ankle (BlazePose index)
  const rightAnkle = keypoints[28]; // right_ankle (BlazePose index)

  if (
    !leftAnkle || !rightAnkle ||
    leftAnkle.visibility < 0.3 ||
    rightAnkle.visibility < 0.3
  ) {
    return null;
  }

  const dx = rightAnkle.x - leftAnkle.x;
  const dy = rightAnkle.y - leftAnkle.y;

  return {
    nose: {
      x: leftAnkle.x - dx * BOARD_EXTEND_RATIO,
      y: leftAnkle.y - dy * BOARD_EXTEND_RATIO,
    },
    tail: {
      x: rightAnkle.x + dx * BOARD_EXTEND_RATIO,
      y: rightAnkle.y + dy * BOARD_EXTEND_RATIO,
    },
  };
}
