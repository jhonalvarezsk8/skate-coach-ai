export type VideoValidationError =
  | "INVALID_FORMAT"
  | "VIDEO_TOO_LONG"
  | "VIDEO_TOO_SHORT"
  | "FILE_TOO_LARGE";

export interface VideoValidationResult {
  ok: boolean;
  error?: VideoValidationError;
  message?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

const ACCEPTED_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_DURATION_SECONDS = 30;
const MIN_DURATION_SECONDS = 0.5;
const MAX_FILE_SIZE_MB = 200;

export async function validateVideo(file: File): Promise<VideoValidationResult> {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: "INVALID_FORMAT",
      message: "Formato não suportado. Use MP4, WebM ou MOV.",
    };
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      ok: false,
      error: "FILE_TOO_LARGE",
      message: `Arquivo muito grande. Máximo ${MAX_FILE_SIZE_MB} MB.`,
    };
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;

      if (duration < MIN_DURATION_SECONDS) {
        resolve({
          ok: false,
          error: "VIDEO_TOO_SHORT",
          message: "Vídeo muito curto. Use um vídeo de pelo menos 0,5 segundos.",
        });
        return;
      }

      if (duration > MAX_DURATION_SECONDS) {
        resolve({
          ok: false,
          error: "VIDEO_TOO_LONG",
          message: `Vídeo muito longo. Use um vídeo de até ${MAX_DURATION_SECONDS} segundos.`,
        });
        return;
      }

      resolve({ ok: true, durationSeconds: duration, width, height });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({
        ok: false,
        error: "INVALID_FORMAT",
        message: "Não foi possível ler o vídeo. Tente outro arquivo.",
      });
    };

    video.src = url;
  });
}
