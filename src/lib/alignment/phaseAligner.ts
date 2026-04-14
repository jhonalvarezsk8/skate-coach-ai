import type { PhaseMap, PhasePair, PhaseName } from "@/types";
import { PHASE_NAMES } from "@/types";

// Aligns user frames with reference frames by matching detected phases.
// Returns a list of (userFrameIndex, refFrameIndex) pairs for each phase.
export function alignPhases(
  userPhases: PhaseMap,
  refPhases: Omit<PhaseMap, "usedFallback">
): PhasePair[] {
  return PHASE_NAMES.map((phase): PhasePair => ({
    phase,
    userFrameIndex: userPhases[phase],
    refFrameIndex: refPhases[phase],
  }));
}
