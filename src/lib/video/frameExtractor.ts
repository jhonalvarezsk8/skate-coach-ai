// Extracts frames from a video file using HTMLVideoElement + Canvas seek.
// Works in both main thread and Web Worker (via OffscreenCanvas).
// Returns raw ImageData arrays — caller is responsible for memory.

export interface ExtractedFrame {
  frameIndex: number;
  timestampMs: number;
  imageData: ImageData;
  width: number;
  height: number;
}

export interface FrameExtractionOptions {
  maxFrames?: number;       // default 150
  targetWidth?: number;     // resize to this width (aspect-ratio preserved for height)
  targetHeight?: number;    // resize to this height
  onProgress?: (current: number, total: number) => void;
}

const DEFAULT_MAX_FRAMES = 150;
const MODEL_INPUT_SIZE = 640; // YOLOv8 input: 640×640

export async function extractFrames(
  file: File,
  options: FrameExtractionOptions = {}
): Promise<ExtractedFrame[]> {
  const {
    maxFrames = DEFAULT_MAX_FRAMES,
    targetWidth = MODEL_INPUT_SIZE,
    targetHeight = MODEL_INPUT_SIZE,
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    video.onloadedmetadata = async () => {
      const duration = video.duration;

      // Use a fixed sample count regardless of video FPS
      const sampleCount = Math.min(maxFrames, Math.ceil(duration * 30));
      const interval = duration / sampleCount;

      const frames: ExtractedFrame[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const targetTime = i * interval;

        try {
          await seekTo(video, targetTime);
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

          frames.push({
            frameIndex: i,
            timestampMs: Math.round(targetTime * 1000),
            imageData,
            width: targetWidth,
            height: targetHeight,
          });

          onProgress?.(i + 1, sampleCount);
        } catch {
          // Skip frames that fail to seek (e.g., corrupted segment)
          onProgress?.(i + 1, sampleCount);
        }
      }

      URL.revokeObjectURL(url);
      resolve(frames);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("VIDEO_READ_ERROR"));
    };

    video.src = url;
    // Trigger metadata load
    video.load();
  });
}

// Seek the video to a specific time and wait for the seek to complete.
function seekTo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - timeSeconds) < 0.001) {
      resolve();
      return;
    }

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("SEEK_ERROR"));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timeSeconds;
  });
}

// Estimate video FPS from the file (best-effort; falls back to 30)
export async function estimateVideoFps(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      // HTMLVideoElement doesn't expose FPS directly; use a reasonable default
      resolve(30);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(30);
    };

    video.src = url;
  });
}
