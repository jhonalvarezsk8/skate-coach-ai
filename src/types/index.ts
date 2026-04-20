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

// ─── Board ───────────────────────────────────────────────────────────────────

export interface BoardKeypoints {
  nose: { x: number; y: number };
  tail: { x: number; y: number };
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
  | { type: "RESULT"; poseFrames: PoseFrame[] }
  | { type: "ERROR"; code: string; message: string };
