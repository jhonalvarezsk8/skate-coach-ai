// ─── Keypoints ───────────────────────────────────────────────────────────────

export interface Keypoint {
  x: number;       // pixel coords in the frame dimensions
  y: number;
  visibility: number; // 0..1 confidence
}

// BlazePose 33 skeleton connections (MediaPipe PoseLandmarker)
export { BLAZEPOSE_SKELETON_CONNECTIONS as SKELETON_CONNECTIONS } from "@/lib/mediapipe/keypointMap";

// ─── Pose Frame ───────────────────────────────────────────────────────────────

export interface PoseFrame {
  frameIndex: number;
  timestampMs: number;
  keypoints: Keypoint[];       // 33 items (BlazePose)
  detectionConf: number;       // overall detection confidence (avg visibility of shoulders+hips)
  frameWidth: number;
  frameHeight: number;
  imageData?: ImageData;       // raw frame pixels (only retained for key frames)
}

// ─── Phases ───────────────────────────────────────────────────────────────────

export type PhaseName = "setup" | "pop" | "flick" | "catch" | "landing";

export const PHASE_NAMES: PhaseName[] = [
  "setup", "pop", "flick", "catch", "landing",
];

export const PHASE_LABELS: Record<PhaseName, string> = {
  setup:   "Setup",
  pop:     "Pop",
  flick:   "Flick",
  catch:   "Catch",
  landing: "Landing",
};

export interface PhaseMap {
  setup: number;    // frame index
  pop: number;
  flick: number;
  catch: number;
  landing: number;
  usedFallback: boolean;
}

// ─── Board ───────────────────────────────────────────────────────────────────

export interface BoardKeypoints {
  nose: { x: number; y: number };
  tail: { x: number; y: number };
}

// ─── Alignment ───────────────────────────────────────────────────────────────

export interface PhasePair {
  phase: PhaseName;
  userFrameIndex: number;
  refFrameIndex: number;
}

// ─── Reference Data ──────────────────────────────────────────────────────────

export interface ReferenceFrameData {
  frame: number;
  keypoints: [number, number][];  // [[x, y], ...]
  confidence: number[];
}

export interface ReferenceData {
  fps: number;
  totalFrames: number;
  phases: Omit<PhaseMap, "usedFallback">;
  frames: ReferenceFrameData[];
  frameWidth?: number;   // original video width used during preprocessing
  frameHeight?: number;  // original video height used during preprocessing
}

// ─── App State ────────────────────────────────────────────────────────────────

export type AppStatus =
  | "idle"
  | "loading_model"
  | "ready"
  | "validating"
  | "extracting"
  | "inferring"
  | "detecting_phases"
  | "rendering"
  | "done"
  | "error";

export interface AppState {
  status: AppStatus;
  progress: number;             // 0..100
  statusMessage: string;
  etaSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// ─── Worker Messages ─────────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: "INIT" }
  | { type: "PROCESS_VIDEO"; videoFile: File }
  | { type: "CANCEL" };

export type WorkerOutMessage =
  | { type: "READY"; provider: string }
  | { type: "PROGRESS"; stage: string; current: number; total: number; etaSeconds: number | null }
  | { type: "PHASES_DETECTED"; phases: PhaseMap }
  | { type: "RESULT"; poseFrames: PoseFrame[]; phases: PhaseMap; keyFrameImages: Record<PhaseName, ImageData> }
  | { type: "ERROR"; code: string; message: string };

// ─── Phase Comparison ────────────────────────────────────────────────────────

export interface PhaseAngles {
  kneeAngle: number;    // degrees
  ankleDiff: number;    // pixels
  hipHeight: number;    // pixels (normalized 0..1)
}

export interface PhaseComparison {
  phase: PhaseName;
  user: PhaseAngles;
  reference: PhaseAngles;
  feedbackKey: string | null;  // key into FEEDBACK_RULES
}
