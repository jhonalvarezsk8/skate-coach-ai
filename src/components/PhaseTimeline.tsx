"use client";

import type { PhaseMap, PhaseName } from "@/types";
import { PHASE_NAMES, PHASE_LABELS } from "@/types";

interface Props {
  phases: PhaseMap;
  activePhase: PhaseName;
  onSelectPhase: (phase: PhaseName) => void;
}

const PHASE_COLORS: Record<PhaseName, { active: string; inactive: string; dot: string }> = {
  setup:   { active: "bg-blue-500",   inactive: "bg-blue-900",   dot: "bg-blue-400" },
  pop:     { active: "bg-orange-500", inactive: "bg-orange-900", dot: "bg-orange-400" },
  flick:   { active: "bg-yellow-500", inactive: "bg-yellow-900", dot: "bg-yellow-400" },
  catch:   { active: "bg-purple-500", inactive: "bg-purple-900", dot: "bg-purple-400" },
  landing: { active: "bg-green-500",  inactive: "bg-green-900",  dot: "bg-green-400" },
};

export default function PhaseTimeline({ phases, activePhase, onSelectPhase }: Props) {
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-1">
        {PHASE_NAMES.map((phase, i) => {
          const isActive = phase === activePhase;
          const colors = PHASE_COLORS[phase];

          return (
            <button
              key={phase}
              onClick={() => onSelectPhase(phase)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all
                ${isActive ? colors.active + " text-white shadow-lg scale-105" : colors.inactive + " text-neutral-400 hover:opacity-80"}`}
            >
              <span className="text-xs font-semibold">{PHASE_LABELS[phase]}</span>
              <span className="text-xs opacity-70">#{phases[phase]}</span>
            </button>
          );
        })}
      </div>

      {phases.usedFallback && (
        <p className="text-amber-500 text-xs text-center">
          Fases estimadas automaticamente (alinhamento temporal)
        </p>
      )}
    </div>
  );
}
