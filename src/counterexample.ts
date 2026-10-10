import type {
  CutConformanceResult,
  TraceConformanceResult,
  TraceStep,
} from "./conformance.js";
import { assessComparators, type ComparatorAssessment } from "./comparators.js";
import type { ValueDifference } from "./canonical.js";
import type { DecisionStateIndex } from "./dsi.js";

export const COUNTEREXAMPLE_SCHEMA =
  "xstate-persistence-counterexample/v1" as const;

export interface PersistenceCounterexample<TEvent = unknown> {
  readonly schema: typeof COUNTEREXAMPLE_SCHEMA;
  readonly cut: number;
  readonly stage: "hydrate" | "repersist" | "continuation";
  readonly suffixOffset?: number;
  readonly prefix: readonly TraceStep<TEvent>[];
  readonly suffix: readonly TraceStep<TEvent>[];
  readonly failingStep?: TraceStep<TEvent>;
  readonly persistedSnapshot: unknown;
  readonly control: DecisionStateIndex;
  readonly restored: DecisionStateIndex;
  readonly differences: readonly ValueDifference[];
  readonly error?: string;
  readonly comparators: ComparatorAssessment;
}

export function counterexampleFromCut<TEvent>(
  cut: CutConformanceResult<TEvent>,
): PersistenceCounterexample<TEvent> | undefined {
  const divergence = cut.firstDivergence;
  if (!divergence) return undefined;

  const continuation =
    divergence.stage === "continuation" &&
    divergence.suffixOffset !== undefined
      ? cut.continuation[divergence.suffixOffset]
      : undefined;

  return {
    schema: COUNTEREXAMPLE_SCHEMA,
    cut: cut.cut,
    stage: divergence.stage,
    ...(divergence.suffixOffset !== undefined
      ? { suffixOffset: divergence.suffixOffset }
      : {}),
    prefix: cut.prefix,
    suffix: cut.suffix,
    ...(continuation ? { failingStep: continuation.step } : {}),
    persistedSnapshot: cut.persistedSnapshot,
    control: continuation?.control ?? cut.hydration.control,
    restored:
      continuation?.restored ??
      cut.repersistence.restored ??
      cut.hydration.restored,
    differences: divergence.differences,
    ...(divergence.error ? { error: divergence.error } : {}),
    comparators: assessComparators(cut),
  };
}

export function firstCounterexample<TEvent>(
  result: TraceConformanceResult<TEvent>,
): PersistenceCounterexample<TEvent> | undefined {
  const failing = result.cuts.find((cut) => !cut.passed);
  return failing ? counterexampleFromCut(failing) : undefined;
}
