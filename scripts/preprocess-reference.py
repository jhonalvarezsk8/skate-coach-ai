#!/usr/bin/env python3
"""
preprocess-reference.py
Roda UMA VEZ localmente para gerar o JSON de keypoints do vídeo de referência.
Requer: pip install mediapipe opencv-python

Uso:
  1. Coloque o vídeo bruto do Ollie de referência na raiz do projeto (Flip.mp4)
     - Grave em câmera lateral (90°), qualquer resolução, 30fps, ~3 segundos
     - Fundo neutro, skatista visível o tempo todo
  2. Execute: python scripts/preprocess-reference.py
  3. Saídas:
       public/reference/ollie-reference-kps.json  ← keypoints por frame (BlazePose 33)
       public/reference/ollie-reference.mp4       ← vídeo comprimido (se ffmpeg disponível)
"""

import json
import math
import os
import subprocess
import sys
from pathlib import Path

# ── Caminhos ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
INPUT_VIDEO  = PROJECT_ROOT / "Flip.mp4"
OUTPUT_JSON  = PROJECT_ROOT / "public" / "reference" / "ollie-reference-kps.json"
OUTPUT_VIDEO = PROJECT_ROOT / "public" / "reference" / "ollie-reference.mp4"
MODEL_PATH   = PROJECT_ROOT / "public" / "models" / "pose_landmarker_lite.task"

# ── Thresholds (mesmos do phaseDetector.ts) ───────────────────────────────────
KNEE_BEND_DEGREES    = 160
SETUP_MIN_FRAMES     = 3
ACC_POP_THRESHOLD    = -2.5
ANKLE_DIFF_RATIO     = 0.08
ANKLE_LEVEL_RATIO    = 0.04
ACC_LAND_THRESHOLD   = 3.0
SMOOTHING_WINDOW     = 3
MIN_VISIBILITY       = 0.3

# BlazePose indices used for phase detection
IDX_LEFT_HIP    = 23
IDX_RIGHT_HIP   = 24
IDX_LEFT_KNEE   = 25
IDX_RIGHT_KNEE  = 26
IDX_LEFT_ANKLE  = 27
IDX_RIGHT_ANKLE = 28


def angle_deg(a, vertex, b):
    ax, ay = a[0] - vertex[0], a[1] - vertex[1]
    bx, by = b[0] - vertex[0], b[1] - vertex[1]
    dot = ax * bx + ay * by
    mag = math.hypot(ax, ay) * math.hypot(bx, by)
    if mag == 0:
        return 180.0
    return math.degrees(math.acos(max(-1, min(1, dot / mag))))


def moving_average(values, window):
    result = []
    for i in range(len(values)):
        start = max(0, i - window // 2)
        end = min(len(values), start + window)
        chunk = values[start:end]
        result.append(sum(chunk) / len(chunk))
    return result


def velocity(values, i):
    return 0.0 if i == 0 else values[i] - values[i - 1]


def acceleration(values, i):
    return 0.0 if i < 2 else velocity(values, i) - velocity(values, i - 1)


def detect_phases(frames_data, frame_height):
    n = len(frames_data)
    if n < 5:
        step = max(1, n // 5)
        return {"setup": 0, "pop": step, "flick": step*2, "catch": step*3, "landing": step*4, "usedFallback": True}

    def get_kp(frame, idx):
        kps = frame["keypoints"]
        conf = frame["confidence"]
        if kps is None or idx >= len(kps):
            return None
        return (kps[idx][0], kps[idx][1], conf[idx] if idx < len(conf) else 0.0)

    hip_y_raw, knee_angles_raw, ankle_diff_raw = [], [], []

    for f in frames_data:
        if f["keypoints"] is None:
            hip_y_raw.append(0)
            knee_angles_raw.append(170.0)
            ankle_diff_raw.append(0.0)
            continue

        lh = get_kp(f, IDX_LEFT_HIP)
        rh = get_kp(f, IDX_RIGHT_HIP)
        lk = get_kp(f, IDX_LEFT_KNEE)
        rk = get_kp(f, IDX_RIGHT_KNEE)
        la = get_kp(f, IDX_LEFT_ANKLE)
        ra = get_kp(f, IDX_RIGHT_ANKLE)

        # Hip Y
        valid = [p for p in [lh, rh] if p and p[2] >= MIN_VISIBILITY]
        hip_y_raw.append(sum(p[1] for p in valid) / len(valid) if valid else 0)

        # Knee angle
        angles = []
        if lh and lk and la and all(p[2] >= MIN_VISIBILITY for p in [lh, lk, la]):
            angles.append(angle_deg(lh[:2], lk[:2], la[:2]))
        if rh and rk and ra and all(p[2] >= MIN_VISIBILITY for p in [rh, rk, ra]):
            angles.append(angle_deg(rh[:2], rk[:2], ra[:2]))
        knee_angles_raw.append(sum(angles) / len(angles) if angles else 170.0)

        # Ankle diff
        if la and ra and la[2] >= MIN_VISIBILITY and ra[2] >= MIN_VISIBILITY:
            ankle_diff_raw.append(la[1] - ra[1])
        else:
            ankle_diff_raw.append(0.0)

    hip_y       = moving_average(hip_y_raw, SMOOTHING_WINDOW)
    knee_angles = moving_average(knee_angles_raw, SMOOTHING_WINDOW)
    ankle_diff  = moving_average(ankle_diff_raw, SMOOTHING_WINDOW)

    ankle_diff_threshold  = ANKLE_DIFF_RATIO * frame_height
    ankle_level_threshold = ANKLE_LEVEL_RATIO * frame_height

    # Setup
    setup = 0
    for i in range(n - SETUP_MIN_FRAMES):
        if all(knee_angles[i + j] < KNEE_BEND_DEGREES for j in range(SETUP_MIN_FRAMES)):
            setup = i
            break

    # Pop
    pop = -1
    max_up_acc = 0
    for i in range(setup + 2, n - 1):
        acc = acceleration(hip_y, i)
        if acc < ACC_POP_THRESHOLD and acc < max_up_acc:
            max_up_acc = acc
            pop = i
    if pop < 0:
        pop = max(range(setup, n), key=lambda i: hip_y[i])
    if pop < 0:
        pop = n // 4

    # Flick
    flick = -1
    max_diff = 0
    for i in range(pop, n):
        d = abs(ankle_diff[i])
        if d > ankle_diff_threshold and d > max_diff:
            max_diff = d
            flick = i
    if flick < 0:
        flick = min(pop + max(1, (n - pop) // 3), n - 1)

    # Catch
    catch = -1
    min_hip = float("inf")
    for i in range(flick, n):
        if hip_y[i] < min_hip and abs(ankle_diff[i]) < ankle_level_threshold:
            min_hip = hip_y[i]
            catch = i
    if catch < 0:
        min_vals = [(hip_y[i], i) for i in range(flick, n)]
        catch = min(min_vals, key=lambda x: x[0])[1] if min_vals else flick
    if catch < 0:
        catch = min(flick + max(1, (n - flick) // 2), n - 1)

    # Landing
    landing = -1
    for i in range(catch + 2, n):
        if acceleration(hip_y, i) > ACC_LAND_THRESHOLD:
            landing = i
            break
    if landing < 0:
        landing = min(catch + max(1, (n - catch) // 2), n - 1)

    # Ensure monotonic order
    phases_list = [setup, pop, flick, catch, landing]
    for i in range(1, len(phases_list)):
        if phases_list[i] <= phases_list[i - 1]:
            phases_list[i] = min(phases_list[i - 1] + 1, n - 1)

    return {
        "setup":   phases_list[0],
        "pop":     phases_list[1],
        "flick":   phases_list[2],
        "catch":   phases_list[3],
        "landing": phases_list[4],
        "usedFallback": False,
    }


def main():
    if not INPUT_VIDEO.exists():
        print(f"❌ Vídeo de entrada não encontrado: {INPUT_VIDEO}")
        print("   Coloque o arquivo Flip.mp4 na raiz do projeto e execute novamente.")
        sys.exit(1)

    if not MODEL_PATH.exists():
        print(f"❌ Modelo MediaPipe não encontrado: {MODEL_PATH}")
        print("   Execute: curl -L https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task -o public/models/pose_landmarker_lite.task")
        sys.exit(1)

    try:
        import mediapipe as mp
        import cv2
    except ImportError:
        print("❌ Dependências não encontradas.")
        print("   Execute: pip install mediapipe opencv-python")
        sys.exit(1)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    print(f"📹 Carregando vídeo: {INPUT_VIDEO}")

    # ── Configurar MediaPipe PoseLandmarker ───────────────────────────────────
    base_options = mp.tasks.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(str(INPUT_VIDEO))
    fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"   {frame_width}×{frame_height} @ {fps:.1f}fps — {total_frames} frames")
    print("🤸 Detectando poses com MediaPipe BlazePose (33 keypoints)...")

    frames_data = []
    frame_idx   = 0
    timestamp_ms = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        result = detector.detect_for_video(mp_image, timestamp_ms)

        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            lms  = result.pose_landmarks[0]   # first person
            kps  = [[round(lm.x * frame_width, 1), round(lm.y * frame_height, 1)] for lm in lms]
            conf = [round(float(lm.visibility) if lm.visibility is not None else 0.9, 3) for lm in lms]
            frames_data.append({
                "frame":      frame_idx,
                "keypoints":  kps,   # 33 BlazePose keypoints in pixel coords
                "confidence": conf,
            })
        else:
            frames_data.append({
                "frame":      frame_idx,
                "keypoints":  None,
                "confidence": [],
            })

        frame_idx    += 1
        timestamp_ms  = int(frame_idx / fps * 1000)

        if frame_idx % 10 == 0:
            print(f"   Frame {frame_idx}/{total_frames}...", end="\r")

    cap.release()
    detector.close()
    print(f"\n✅ {frame_idx} frames processados")

    # Detect phases
    print("🔍 Detectando fases do Ollie...")
    phases = detect_phases(frames_data, frame_height)
    print(f"   Setup: {phases['setup']}  Pop: {phases['pop']}  Flick: {phases['flick']}  Catch: {phases['catch']}  Landing: {phases['landing']}")
    if phases.get("usedFallback"):
        print("   ⚠️  Fallback temporal utilizado — thresholds podem precisar de ajuste")

    # Build output JSON
    output = {
        "fps":         fps,
        "totalFrames": frame_idx,
        "frameWidth":  frame_width,
        "frameHeight": frame_height,
        "phases": {k: v for k, v in phases.items() if k != "usedFallback"},
        "frames": frames_data,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = OUTPUT_JSON.stat().st_size / 1024
    print(f"💾 JSON salvo: {OUTPUT_JSON}  ({size_kb:.1f} KB)")

    # Compress video with ffmpeg if available
    print("🎬 Tentando comprimir vídeo com ffmpeg...")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(INPUT_VIDEO),
                "-crf", "28",
                "-vf", "scale=720:-2",
                "-movflags", "+faststart",
                str(OUTPUT_VIDEO),
            ],
            check=True,
            capture_output=True,
        )
        size_mb = OUTPUT_VIDEO.stat().st_size / (1024 * 1024)
        print(f"✅ Vídeo comprimido: {OUTPUT_VIDEO}  ({size_mb:.1f} MB)")
    except (subprocess.CalledProcessError, FileNotFoundError):
        import shutil
        shutil.copy(str(INPUT_VIDEO), str(OUTPUT_VIDEO))
        print(f"⚠️  ffmpeg não encontrado — vídeo copiado sem compressão: {OUTPUT_VIDEO}")

    print("\n🏄 Pré-processamento concluído! Execute 'npm run dev' para testar.")


if __name__ == "__main__":
    main()
