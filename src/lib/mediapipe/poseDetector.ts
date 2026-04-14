// Converts MediaPipe PoseLandmarkerResult to the app's PoseFrame format.
// Replaces the ONNX-based onnx/poseDetector.ts pre/post-processing pipeline.

import type { PoseFrame, Keypoint } from "@/types";

// Indices used to compute overall detection confidence (shoulders + hips)
const CONF_INDICES = [11, 12, 23, 24];

export function mediapipeResultToPoseFrame(
  // PoseLandmarkerResult — typed as any to avoid importing @mediapipe/tasks-vision at build time
  // (the module is loaded via webpackIgnore dynamic import in the worker)
  result: any, // noqa — typed as any to avoid importing @mediapipe/tasks-vision at build time
  frameIndex: number,
  timestampMs: number,
  frameWidth: number,
  frameHeight: number,
): PoseFrame {
  if (!result.landmarks || result.landmarks.length === 0) {
    // No person detected — return 33 zero-confidence keypoints
    return {
      frameIndex,
      timestampMs,
      keypoints: Array(33).fill({ x: 0, y: 0, visibility: 0 }),
      detectionConf: 0,
      frameWidth,
      frameHeight,
    };
  }

  const landmarks = result.landmarks[0]; // first detected person

  // Denormalize: MediaPipe returns normalized (0-1) coords relative to the input image
  const keypoints: Keypoint[] = landmarks.map((lm: { x: number; y: number; visibility: number }) => ({
    x: lm.x * frameWidth,
    y: lm.y * frameHeight,
    visibility: lm.visibility ?? 0,
  }));

  // Overall confidence = average visibility of shoulders + hips
  const detectionConf =
    CONF_INDICES.reduce((sum, i) => sum + (keypoints[i]?.visibility ?? 0), 0) / CONF_INDICES.length;

  return {
    frameIndex,
    timestampMs,
    keypoints,
    detectionConf,
    frameWidth,
    frameHeight,
  };
}
