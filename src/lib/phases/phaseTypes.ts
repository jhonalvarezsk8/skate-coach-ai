// Phase detection thresholds — adjust empirically with real skate videos
// All pixel-based thresholds are relative to frame height unless noted

export const PHASE_THRESHOLDS = {
  // Setup: knees start bending
  KNEE_BEND_DEGREES: 160,      // below this angle → knees are bending
  SETUP_MIN_FRAMES: 3,         // must hold for N consecutive frames

  // Pop: deepest crouch before launching
  // Acceleration in pixels/frame² (Y axis, positive = downward)
  ACC_POP_THRESHOLD: -2.5,     // hipY accel below this → launching upward

  // Flick: front foot slides forward/up relative to back foot
  ANKLE_DIFF_RATIO: 0.08,      // ankle_left.y - ankle_right.y > ratio × frameHeight

  // Catch: peak of jump, board roughly level
  ANKLE_LEVEL_RATIO: 0.04,     // |ankle_left.y - ankle_right.y| < ratio × frameHeight

  // Landing: deceleration after airborne
  ACC_LAND_THRESHOLD: 3.0,     // hipY accel above this → absorbing impact

  // Smoothing
  SMOOTHING_WINDOW: 3,         // moving-average window size (frames)

  // Minimum visibility to use a keypoint
  MIN_VISIBILITY: 0.3,
} as const;
