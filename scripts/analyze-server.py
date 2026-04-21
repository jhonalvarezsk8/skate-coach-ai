#!/usr/bin/env python3
"""
analyze-server.py
Recebe um caminho de vídeo via argv[1] e imprime no stdout um JSON com os
keypoints detectados pelo MediaPipe. Usado pela rota /api/analyze do Next.js.

Saída (stdout): JSON no mesmo formato do ollie-reference-kps.json.
Logs (stderr): progresso em formato "PROGRESS frame/total" e erros.

Configuração idêntica à do preprocess-reference.py:
  - Modelo Full
  - VIDEO mode
  - thresholds 0.3/0.3/0.3
  - resolução original
"""

import json
import sys
from pathlib import Path

SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
MODEL_PATH   = PROJECT_ROOT / "public" / "models" / "pose_landmarker_full.task"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def main():
    if len(sys.argv) < 2:
        log("[ERRO] Uso: analyze-server.py <video_path>")
        sys.exit(1)

    input_video = Path(sys.argv[1]).resolve()
    if not input_video.exists():
        log(f"[ERRO] Video nao encontrado: {input_video}")
        sys.exit(1)

    if not MODEL_PATH.exists():
        log(f"[ERRO] Modelo nao encontrado: {MODEL_PATH}")
        sys.exit(1)

    try:
        import mediapipe as mp
        import cv2
    except ImportError as e:
        log(f"[ERRO] Dependencias: {e}")
        sys.exit(1)

    base_options = mp.tasks.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(str(input_video))
    fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    log(f"[INFO] {frame_width}x{frame_height} @ {fps:.1f}fps -- {total_frames} frames")

    frames_data = []
    frame_idx = 0
    timestamp_ms = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        result = detector.detect_for_video(mp_image, timestamp_ms)

        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            lms  = result.pose_landmarks[0]
            kps  = [[round(lm.x * frame_width, 1), round(lm.y * frame_height, 1)] for lm in lms]
            conf = [round(float(lm.visibility) if lm.visibility is not None else 0.9, 3) for lm in lms]
            frames_data.append({"frame": frame_idx, "keypoints": kps, "confidence": conf})
        else:
            frames_data.append({"frame": frame_idx, "keypoints": None, "confidence": []})

        frame_idx += 1
        timestamp_ms = int(frame_idx / fps * 1000)

        if frame_idx % 5 == 0:
            log(f"PROGRESS {frame_idx}/{total_frames}")

    cap.release()
    detector.close()
    log(f"[INFO] {frame_idx} frames processados")

    output = {
        "fps":         fps,
        "totalFrames": frame_idx,
        "frameWidth":  frame_width,
        "frameHeight": frame_height,
        "frames":      frames_data,
    }

    # JSON vai pro stdout (Next.js lê dali)
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
