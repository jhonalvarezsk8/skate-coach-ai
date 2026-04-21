"""
SkateCoach AI — backend de análise de pose.
FastAPI + MediaPipe PoseLandmarker Full (VIDEO mode, thresholds 0.3).
Espelha o comportamento do scripts/analyze-server.py, agora como HTTP.
"""

import json
import logging
import os
import subprocess
import tempfile
import traceback
import urllib.request
from pathlib import Path

import cv2
import imageio_ffmpeg
import mediapipe as mp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("skaia")

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)
MODEL_PATH = Path(os.environ.get("MODEL_PATH", "/tmp/pose_landmarker_full.task"))

FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()


def ensure_model() -> Path:
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000:
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


_detector = None


def get_detector():
    global _detector
    if _detector is not None:
        return _detector
    model_path = ensure_model()
    base_options = mp.tasks.BaseOptions(model_asset_path=str(model_path))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    _detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
    return _detector


app = FastAPI(title="SkateCoach AI — Pose Analyzer")

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"service": "skaia-pose-analyzer", "status": "ok"}


@app.get("/health")
def health():
    ensure_model()
    return {"status": "ok", "model": "pose_landmarker_full"}


@app.post("/analyze")
async def analyze(req: Request):
    body = await req.body()
    if not body:
        raise HTTPException(status_code=400, detail="EMPTY_BODY")

    log.info("analyze: received %d bytes", len(body))

    raw = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
    transcoded = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    transcoded.close()
    try:
        raw.write(body)
        raw.close()

        transcode(raw.name, transcoded.name)
        result = run_analyzer(transcoded.name)
        log.info(
            "analyze: %d frames, %dx%d, %.1ffps",
            result["totalFrames"],
            result["frameWidth"],
            result["frameHeight"],
            result["fps"],
        )
        return Response(
            content=json.dumps(result, separators=(",", ":")),
            media_type="application/json",
        )
    except Exception as exc:
        log.error("analyze failed: %s\n%s", exc, traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": "ANALYZE_FAILED", "message": str(exc)},
        )
    finally:
        for path in (raw.name, transcoded.name):
            try:
                os.unlink(path)
            except OSError:
                pass


def transcode(src: str, dst: str) -> None:
    """
    Re-encoda entrada (HEVC, .mov, slow-mo variável) para H.264/mp4
    padronizado e já redimensionado:
      - Lado menor <= 720px (MediaPipe roda em 256x256 internamente,
        nada a ganhar acima disso).
      - fps <= 30 (iPhone 60fps dobra memória/tempo sem ganho de pose).
      - yuv420p + faststart pra decodificação confiável.
    Isso mantém o pico de RAM dentro dos 512MB do plano free do Render.
    """
    vf = (
        "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(ih,iw),-2,min(720,ih))'"
        ",fps=30"
    )
    cmd = [
        FFMPEG_BIN,
        "-y",
        "-loglevel", "error",
        "-i", src,
        "-vf", vf,
        "-vcodec", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-an",
        "-movflags", "+faststart",
        dst,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"TRANSCODE_FAILED: {proc.stderr.strip()[-500:]}")


def run_analyzer(video_path: str) -> dict:
    detector = get_detector()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("VIDEO_OPEN_FAILED")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frames_data = []
    frame_idx = 0
    timestamp_ms = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        result = detector.detect_for_video(mp_image, timestamp_ms)

        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            lms = result.pose_landmarks[0]
            kps = [
                [round(lm.x * frame_width, 1), round(lm.y * frame_height, 1)]
                for lm in lms
            ]
            conf = [
                round(float(lm.visibility) if lm.visibility is not None else 0.9, 3)
                for lm in lms
            ]
            frames_data.append(
                {"frame": frame_idx, "keypoints": kps, "confidence": conf}
            )
        else:
            frames_data.append(
                {"frame": frame_idx, "keypoints": None, "confidence": []}
            )

        frame_idx += 1
        timestamp_ms = int(frame_idx / fps * 1000)

    cap.release()

    return {
        "fps": fps,
        "totalFrames": frame_idx,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "frames": frames_data,
    }
