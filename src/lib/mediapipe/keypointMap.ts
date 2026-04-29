// BlazePose 33 keypoint indices (MediaPipe PoseLandmarker output order)
// https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
export const BLAZEPOSE_KEYPOINT_NAMES = [
  "nose",             // 0
  "left_eye_inner",   // 1
  "left_eye",         // 2
  "left_eye_outer",   // 3
  "right_eye_inner",  // 4
  "right_eye",        // 5
  "right_eye_outer",  // 6
  "left_ear",         // 7
  "right_ear",        // 8
  "mouth_left",       // 9
  "mouth_right",      // 10
  "left_shoulder",    // 11
  "right_shoulder",   // 12
  "left_elbow",       // 13
  "right_elbow",      // 14
  "left_wrist",       // 15
  "right_wrist",      // 16
  "left_pinky",       // 17
  "right_pinky",      // 18
  "left_index",       // 19
  "right_index",      // 20
  "left_thumb",       // 21
  "right_thumb",      // 22
  "left_hip",         // 23
  "right_hip",        // 24
  "left_knee",        // 25
  "right_knee",       // 26
  "left_ankle",       // 27
  "right_ankle",      // 28
  "left_heel",        // 29
  "right_heel",       // 30
  "left_foot_index",  // 31
  "right_foot_index", // 32
] as const;

// Mapping: COCO 17 index → BlazePose 33 index
// Used to update phaseDetector, boardEstimator, feedbackPanel (which used COCO indices 11-16)
export const COCO_TO_BLAZEPOSE: Record<number, number> = {
  0:  0,  // nose
  1:  2,  // left_eye
  2:  5,  // right_eye
  3:  7,  // left_ear
  4:  8,  // right_ear
  5:  11, // left_shoulder
  6:  12, // right_shoulder
  7:  13, // left_elbow
  8:  14, // right_elbow
  9:  15, // left_wrist
  10: 16, // right_wrist
  11: 23, // left_hip
  12: 24, // right_hip
  13: 25, // left_knee
  14: 26, // right_knee
  15: 27, // left_ankle
  16: 28, // right_ankle
};

// BlazePose 33 skeleton connections used for rendering
// Face (0-10) excluded — not relevant for skate analysis
// Hands: only index finger (19/20) kept; pinky (17/18) and thumb (21/22) excluded
export const BLAZEPOSE_SKELETON_CONNECTIONS: [number, number][] = [
  // Shoulders
  [11, 12],
  // Left arm (shoulder → elbow → wrist → index finger)
  [11, 13], [13, 15], [15, 19],
  // Right arm (shoulder → elbow → wrist → index finger)
  [12, 14], [14, 16], [16, 20],
  // Torso
  [11, 23], [12, 24], [23, 24],
  // Left leg
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];
