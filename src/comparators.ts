import { stableStringify } from "./canonical.js";
import type { CutConformanceResult } from "./conformance.js";

export type ComparatorVerdict = "pass" | "fail" | "unavailable";

export interface ComparatorAssessment {
  readonly visibleStateOnly: ComparatorVerdict;
  readonly rawPersistedDeepDiff: ComparatorVerdict;
  readonly dsiHydration: ComparatorVerdict;
  readonly repersistenceClosure: ComparatorVerdict;
  readonly continuationOnly: ComparatorVerdict;
  readonly fullConformance: ComparatorVerdict;
}

function verdict(value: boolean): ComparatorVerdict {
  return value ? "pass" : "fail";
}

export function assessComparators(
  cut: CutConformanceResult,
): ComparatorAssessment {
  const rawPersistedDeepDiff =
    cut.repersistence.persistedSnapshot === undefined
      ? "unavailable" as const
      : verdict(
          stableStringify(cut.persistedSnapshot) ===
            stableStringify(cut.repersistence.persistedSnapshot),
        );

  return {
    visibleStateOnly: verdict(
      stableStringify(cut.hydration.control.value) ===
        stableStringify(cut.hydration.restored.value),
    ),
    rawPersistedDeepDiff,
    dsiHydration: verdict(cut.hydration.equivalent),
    repersistenceClosure: verdict(
      cut.repersistence.ok && cut.repersistence.equivalent,
    ),
    continuationOnly: verdict(
      cut.continuation.every((observation) => observation.equivalent),
    ),
    fullConformance: verdict(cut.passed),
  };
}
