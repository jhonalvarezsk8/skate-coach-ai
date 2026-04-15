// MediaPipe PoseLandmarker session factory.
// Loaded inside the Web Worker via webpackIgnore dynamic import.
// Mirrors the singleton pattern of the old onnx/sessionManager.ts.

export interface PoseSessionInfo {
  provider: string;
}

export interface PoseSession {
  landmarker: any; // PoseLandmarker — typed as any to avoid importing @mediapipe/tasks-vision at build time
  info: PoseSessionInfo;
}

let _sessionPromise: Promise<PoseSession> | null = null;

export function getOrCreatePoseSession(): Promise<PoseSession> {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = _createSession();
  return _sessionPromise;
}

async function _createSession(): Promise<PoseSession> {
  // Load the MediaPipe bundle from the static public directory.
  // webpackIgnore prevents Terser from trying to bundle this at build time.
  const mpUrl = new URL("/js/mediapipe-vision.mjs", self.location.origin).href;
  const { FilesetResolver, PoseLandmarker } = await import(/* webpackIgnore: true */ mpUrl) as any;

  const vision = await FilesetResolver.forVisionTasks(
    new URL("/wasm/mediapipe/", self.location.origin).href
  );

  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: new URL("/models/pose_landmarker_full.task", self.location.origin).href,
      delegate: "GPU", // automatic fallback to CPU
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return { landmarker, info: { provider: "mediapipe-wasm" } };
}
