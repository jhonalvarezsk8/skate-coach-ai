"use client";

import type { AppState } from "@/types";

interface Props {
  state: AppState;
  onCancel: () => void;
}

export default function ProcessingPanel({ state, onCancel }: Props) {
  const { progress, statusMessage, etaSeconds } = state;

  return (
    <div className="w-full max-w-md flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-neutral-300 text-sm">{statusMessage}</p>
        {etaSeconds !== null && etaSeconds > 0 && (
          <p className="text-neutral-500 text-xs">~{etaSeconds}s restantes</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
        <div
          className="bg-red-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-neutral-500 text-xs">{progress}%</span>
        <button
          onClick={onCancel}
          className="text-neutral-400 text-xs hover:text-neutral-200 transition-colors underline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
