#!/usr/bin/env python3
"""
process-user-video.py
Processa um vídeo qualquer do usuário com a MESMA pipeline do script de referência
(Full model, VIDEO mode, thresholds 0.3, resolução original) e cospe um JSON +
o MP4 numa pasta de teste que o modo de debug da UI carrega diretamente.

Requer: pip install mediapipe opencv-python

Uso:
  python scripts/process-user-video.py caminho/do/seu/video.mp4

Saídas:
  public/test/test-user.mp4          ← cópia do vídeo
  public/test/test-user-kps.json     ← keypoints por frame (BlazePose 33)

Depois, abra:  http://localhost:3002/debug
"""

import json
import shutil
import sys
from pathlib import Path

SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
MODEL_PATH   = PROJECT_ROOT / "public" / "models" / "pose_landmarker_full.task"
OUTPUT_DIR   = PROJECT_ROOT / "public" / "test"
OUTPUT_JSON  = OUTPUT_DIR / "test-user-kps.json"
OUTPUT_VIDEO = OUTPUT_DIR / "test-user.mp4"


def main():
    if len(sys.argv) < 2:
        print("Uso: python scripts/process-user-video.py <caminho/do/video.mp4>")
        sys.exit(1)

    input_video = Path(sys.argv[1]).resolve()
    if not input_video.exists():
        print(f"[ERRO] Video nao encontrado: {input_video}")
        sys.exit(1)

    if not MODEL_PATH.exists():
        print(f"[ERRO] Modelo MediaPipe nao encontrado: {MODEL_PATH}")
        sys.exit(1)

    try:
        import mediapipe as mp
        import cv2
    except ImportError:
        print("[ERRO] Dependencias nao encontradas.")
        print("       Execute: pip install mediapipe opencv-python")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[VIDEO] Carregando: {input_video}")

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

    print(f"        {frame_width}x{frame_height} @ {fps:.1f}fps -- {total_frames} frames")
    print("[POSE] Detectando keypoints (Full / VIDEO mode / thresholds 0.3)...")

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

        if frame_idx % 10 == 0:
            print(f"        Frame {frame_idx}/{total_frames}...", end="\r")

    cap.release()
    detector.close()
    print(f"\n[OK] {frame_idx} frames processados")

    output = {
        "fps":         fps,
        "totalFrames": frame_idx,
        "frameWidth":  frame_width,
        "frameHeight": frame_height,
        "frames":      frames_data,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = OUTPUT_JSON.stat().st_size / 1024
    print(f"[JSON] Salvo: {OUTPUT_JSON} ({size_kb:.1f} KB)")

    shutil.copy(str(input_video), str(OUTPUT_VIDEO))
    size_mb = OUTPUT_VIDEO.stat().st_size / (1024 * 1024)
    print(f"[MP4]  Copiado: {OUTPUT_VIDEO} ({size_mb:.1f} MB)")

    print("\n[PRONTO] Abra http://localhost:3002/debug no navegador.")


if __name__ == "__main__":
    main()
