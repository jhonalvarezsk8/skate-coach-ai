"use client";

import type { PhaseName, PoseFrame, PhaseMap } from "@/types";
import { PHASE_LABELS } from "@/types";

interface Props {
  userFrames: PoseFrame[];
  phases: PhaseMap;
  activePhase: PhaseName;
}

function kneeAngleDeg(frame: PoseFrame, side: "left" | "right"): number {
  const kps = frame.keypoints;
  // BlazePose indices: left hip=23, right hip=24, left knee=25, right knee=26, left ankle=27, right ankle=28
  const hip   = side === "left" ? kps[23] : kps[24];
  const knee  = side === "left" ? kps[25] : kps[26];
  const ankle = side === "left" ? kps[27] : kps[28];

  if (hip.visibility < 0.3 || knee.visibility < 0.3 || ankle.visibility < 0.3) return 170;

  const ax = hip.x - knee.x, ay = hip.y - knee.y;
  const bx = ankle.x - knee.x, by = ankle.y - knee.y;
  const dot = ax * bx + ay * by;
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (mag === 0) return 170;
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

function generateFeedback(frame: PoseFrame, phase: PhaseName): string | null {
  const kps = frame.keypoints;
  const lAnkle = kps[27]; // left_ankle (BlazePose)
  const rAnkle = kps[28]; // right_ankle (BlazePose)
  const ankleDiff = Math.abs(lAnkle.y - rAnkle.y);
  const frameH = frame.frameHeight;
  const lKneeAngle = kneeAngleDeg(frame, "left");
  const rKneeAngle = kneeAngleDeg(frame, "right");
  const avgKneeAngle = (lKneeAngle + rKneeAngle) / 2;

  switch (phase) {
    case "setup":
      if (avgKneeAngle > 155) return "Dobre mais os joelhos no setup para gerar mais potência.";
      if (avgKneeAngle < 110) return "Setup muito agachado — pode comprometer o equilíbrio.";
      return "Posição de setup equilibrada.";

    case "pop":
      if (avgKneeAngle > 140) return "Empurre o tail com mais força — joelhos precisam estar mais dobrados no pop.";
      return "Pop bem executado!";

    case "flick":
      if (ankleDiff < frameH * 0.05) return "Flick mais agressivo: o pé dianteiro precisa subir mais.";
      if (ankleDiff > frameH * 0.2)  return "Bom flick! Certifique-se de guiar o board com o tornozelo.";
      return "Flick consistente.";

    case "catch":
      if (ankleDiff > frameH * 0.06) return "Nivele os pés mais cedo para um catch limpo.";
      return "Catch em posição equilibrada.";

    case "landing":
      if (avgKneeAngle > 160) return "Absorva o impacto dobrando mais os joelhos na aterrissagem.";
      return "Aterrissagem com boa absorção.";

    default:
      return null;
  }
}

export default function FeedbackPanel({ userFrames, phases, activePhase }: Props) {
  const frameIdx = phases[activePhase];
  const frame = userFrames[frameIdx];

  if (!frame) return null;

  const feedback = generateFeedback(frame, activePhase);

  return (
    <div className="w-full bg-neutral-900 rounded-xl p-4 border border-neutral-800">
      <h3 className="text-sm font-semibold text-neutral-300 mb-2">
        Feedback — {PHASE_LABELS[activePhase]}
      </h3>
      {feedback ? (
        <p className="text-neutral-200 text-sm">{feedback}</p>
      ) : (
        <p className="text-neutral-500 text-sm italic">Sem dados suficientes para este frame.</p>
      )}
    </div>
  );
}
