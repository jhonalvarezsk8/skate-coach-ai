"""
SkateCoach AI — backend de análise de pose.
FastAPI + MediaPipe PoseLandmarker Full (VIDEO mode, thresholds 0.3).
Espelha o comportamento do scripts/analyze-server.py, agora como HTTP.
"""

import json
import os
import tempfile
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/latest/pose_landmarker_full.task"
)
MODEL_PATH = Path(os.environ.get("MODEL_PATH", "/tmp/pose_landmarker_full.task"))


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

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    try:
        tmp.write(body)
        tmp.close()
        result = run_analyzer(tmp.name)
        return Response(
            content=json.dumps(result, separators=(",", ":")),
            media_type="application/json",
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": "ANALYZE_FAILED", "message": str(exc)},
        )
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


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
