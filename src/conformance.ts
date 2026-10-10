import {
  SimulatedClock,
  createActor,
  type AnyActorLogic,
  type AnyActorRef,
} from "xstate";
import { differences, stableStringify, type ValueDifference } from "./canonical.js";
import { decisionStateIndex, type DecisionStateIndex } from "./dsi.js";

export type TraceStep<TEvent = unknown> =
  | { readonly kind: "event"; readonly event: TEvent }
  | { readonly kind: "advance"; readonly ms: number };

export interface PersistenceScenario<TEvent = unknown> {
  readonly logic: AnyActorLogic;
  readonly trace: readonly TraceStep<TEvent>[];
  readonly input?: unknown;
  readonly cutPoints?: readonly number[];
}

export interface StepObservation<TEvent = unknown> {
  readonly offset: number;
  readonly step: TraceStep<TEvent>;
  readonly control: DecisionStateIndex;
  readonly restored: DecisionStateIndex;
  readonly equivalent: boolean;
  readonly differences: readonly ValueDifference[];
}

export interface RepersistenceObservation {
  readonly ok: boolean;
  readonly equivalent: boolean;
  readonly persistedSnapshot?: unknown;
  readonly restored?: DecisionStateIndex;
  readonly differences: readonly ValueDifference[];
  readonly error?: string;
}

export interface CutConformanceResult<TEvent = unknown> {
  readonly cut: number;
  readonly prefix: readonly TraceStep<TEvent>[];
  readonly suffix: readonly TraceStep<TEvent>[];
  readonly persistedSnapshot: unknown;
  readonly hydration: {
    readonly control: DecisionStateIndex;
    readonly restored: DecisionStateIndex;
    readonly equivalent: boolean;
    readonly differences: readonly ValueDifference[];
  };
  readonly repersistence: RepersistenceObservation;
  readonly continuation: readonly StepObservation<TEvent>[];
  readonly passed: boolean;
  readonly firstDivergence?: {
    readonly stage: "hydrate" | "repersist" | "continuation";
    readonly suffixOffset?: number;
    readonly differences: readonly ValueDifference[];
    readonly error?: string;
  };
}

export interface TraceConformanceResult<TEvent = unknown> {
  readonly passed: boolean;
  readonly cuts: readonly CutConformanceResult<TEvent>[];
  readonly firstFailingCut?: number;
}

interface ActorRun {
  readonly actor: AnyActorRef;
  readonly clock: SimulatedClock;
}

function actorOptions(input: unknown, snapshot?: unknown, clock?: SimulatedClock): Record<string, unknown> {
  return {
    ...(input !== undefined ? { input } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(clock !== undefined ? { clock } : {}),
  };
}

function makeActor(logic: AnyActorLogic, input: unknown, snapshot?: unknown): ActorRun {
  const clock = new SimulatedClock();
  const actor = createActor(
    logic,
    actorOptions(input, snapshot, clock) as never,
  ) as AnyActorRef;

  // Conformance wants actor failures as observable state, not an unhandled
  // process exception that aborts the counterexample run.
  actor.subscribe({ error: () => {} });
  actor.start();
  return { actor, clock };
}

function apply<TEvent>(run: ActorRun, step: TraceStep<TEvent>): void {
  if (step.kind === "advance") {
    if (!Number.isFinite(step.ms) || step.ms < 0) {
      throw new TypeError("advance.ms must be a finite non-negative number");
    }
    run.clock.increment(step.ms);
    return;
  }
  run.actor.send(step.event as never);
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function sameIndex(left: DecisionStateIndex, right: DecisionStateIndex): boolean {
  const withoutDigest = (index: DecisionStateIndex) => {
    const { digest: _digest, ...body } = index;
    return body;
  };
  return stableStringify(withoutDigest(left)) === stableStringify(withoutDigest(right));
}

function indexDifferences(left: DecisionStateIndex, right: DecisionStateIndex): ValueDifference[] {
  const { digest: _leftDigest, ...expected } = left;
  const { digest: _rightDigest, ...actual } = right;
  return differences(expected, actual);
}

function validateCut(cut: number, traceLength: number): void {
  if (!Number.isInteger(cut) || cut < 0 || cut > traceLength) {
    throw new RangeError("cut point must be an integer between 0 and trace length");
  }
}

function checkRepersistence(
  logic: AnyActorLogic,
  input: unknown,
  restored: ActorRun,
): RepersistenceObservation {
  try {
    const persistedAgain = jsonRoundTrip(restored.actor.getPersistedSnapshot());
    const restoredAgain = makeActor(logic, input, persistedAgain);
    try {
      const expected = decisionStateIndex(restored.actor);
      const actual = decisionStateIndex(restoredAgain.actor);
      const equivalent = sameIndex(expected, actual);
      return {
        ok: true,
        equivalent,
        persistedSnapshot: persistedAgain,
        restored: actual,
        differences: equivalent ? [] : indexDifferences(expected, actual),
      };
    } finally {
      restoredAgain.actor.stop();
    }
  } catch (caught) {
    return {
      ok: false,
      equivalent: false,
      differences: [],
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

export function checkPersistenceAtCut<TEvent>(
  scenario: PersistenceScenario<TEvent>,
  cut: number,
): CutConformanceResult<TEvent> {
  validateCut(cut, scenario.trace.length);
  const prefix = scenario.trace.slice(0, cut);
  const suffix = scenario.trace.slice(cut);
  const control = makeActor(scenario.logic, scenario.input);

  try {
    for (const step of prefix) apply(control, step);

    const before = decisionStateIndex(control.actor);
    const persistedSnapshot = jsonRoundTrip(control.actor.getPersistedSnapshot());
    const restored = makeActor(scenario.logic, scenario.input, persistedSnapshot);

    try {
      // A restored deterministic clock starts at zero. Bring it to the same
      // trace-relative time already consumed by prefix advances.
      const consumedMs = prefix.reduce(
        (sum, step) => sum + (step.kind === "advance" ? step.ms : 0),
        0,
      );
      if (consumedMs > 0) restored.clock.set(consumedMs);

      const afterHydrate = decisionStateIndex(restored.actor);
      const hydrationEquivalent = sameIndex(before, afterHydrate);
      const hydrationDifferences = hydrationEquivalent
        ? []
        : indexDifferences(before, afterHydrate);

      const repersistence = checkRepersistence(
        scenario.logic,
        scenario.input,
        restored,
      );

      const continuation: StepObservation<TEvent>[] = [];
      for (let offset = 0; offset < suffix.length; offset++) {
        const step = suffix[offset]!;
        apply(control, step);
        apply(restored, step);
        const controlIndex = decisionStateIndex(control.actor);
        const restoredIndex = decisionStateIndex(restored.actor);
        const equivalent = sameIndex(controlIndex, restoredIndex);
        continuation.push({
          offset,
          step,
          control: controlIndex,
          restored: restoredIndex,
          equivalent,
          differences: equivalent ? [] : indexDifferences(controlIndex, restoredIndex),
        });
      }

      const firstContinuationFailure = continuation.find((item) => !item.equivalent);
      const firstDivergence = !hydrationEquivalent
        ? {
            stage: "hydrate" as const,
            differences: hydrationDifferences,
          }
        : !repersistence.ok || !repersistence.equivalent
          ? {
              stage: "repersist" as const,
              differences: repersistence.differences,
              ...(repersistence.error ? { error: repersistence.error } : {}),
            }
          : firstContinuationFailure
            ? {
                stage: "continuation" as const,
                suffixOffset: firstContinuationFailure.offset,
                differences: firstContinuationFailure.differences,
              }
            : undefined;

      return {
        cut,
        prefix,
        suffix,
        persistedSnapshot,
        hydration: {
          control: before,
          restored: afterHydrate,
          equivalent: hydrationEquivalent,
          differences: hydrationDifferences,
        },
        repersistence,
        continuation,
        passed:
          hydrationEquivalent &&
          repersistence.ok &&
          repersistence.equivalent &&
          !firstContinuationFailure,
        ...(firstDivergence ? { firstDivergence } : {}),
      };
    } finally {
      restored.actor.stop();
    }
  } finally {
    control.actor.stop();
  }
}

export function checkPersistenceTrace<TEvent>(
  scenario: PersistenceScenario<TEvent>,
): TraceConformanceResult<TEvent> {
  const cuts = scenario.cutPoints
    ? [...new Set(scenario.cutPoints)]
    : Array.from({ length: scenario.trace.length + 1 }, (_, index) => index);
  cuts.forEach((cut) => validateCut(cut, scenario.trace.length));
  const results = cuts.sort((a, b) => a - b).map((cut) => checkPersistenceAtCut(scenario, cut));
  const firstFailing = results.find((result) => !result.passed);
  return {
    passed: !firstFailing,
    cuts: results,
    ...(firstFailing ? { firstFailingCut: firstFailing.cut } : {}),
  };
}
