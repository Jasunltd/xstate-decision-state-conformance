import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as x5332 from "xstate";
import * as x5192 from "xstate-v5192";
import * as x6prev from "xstate-v6-prev";
import * as x6 from "xstate-v6";
import {
  compareDecisionStateIndexes,
  decisionStateIndex,
  stableStringify,
  type DecisionStateIndex,
} from "./index.js";

export const BENCHMARK_SCHEMA = "xstate-persistence-benchmark/v1" as const;
export const BENCHMARK_SEED = 0x51a7e;

type Family =
  | "linear"
  | "context"
  | "guarded"
  | "history"
  | "timer"
  | "child";

export interface CorpusSpec {
  readonly id: string;
  readonly family: Family;
  readonly variant: number;
  readonly depth: number;
  readonly threshold: number;
  readonly delay: number;
}

interface RuntimeAdapter {
  readonly id: string;
  readonly label: string;
  readonly generation: "v5" | "v6";
  readonly xs: any;
}

interface CompiledCase {
  readonly spec: CorpusSpec;
  readonly logic: any;
  readonly trace: readonly BenchmarkStep[];
}

type BenchmarkStep =
  | { readonly kind: "event"; readonly event: Record<string, unknown> }
  | {
      readonly kind: "child-event";
      readonly key: string;
      readonly event: Record<string, unknown>;
    }
  | { readonly kind: "advance"; readonly ms: number };

interface ActorRun {
  readonly actor: any;
  readonly clock: any;
}

interface CutResult {
  readonly passed: boolean;
  readonly hydrationEquivalent: boolean;
  readonly repersistenceEquivalent: boolean;
  readonly continuationEquivalent: boolean;
  readonly control: DecisionStateIndex;
  readonly restored: DecisionStateIndex;
  readonly persistedSnapshot: any;
  readonly persistedAgain?: any;
  readonly stage?: "hydrate" | "repersist" | "continuation" | "restore-error";
  readonly error?: string;
  readonly cut: number;
  readonly suffixOffset?: number;
}

interface RuntimeSummary {
  readonly runtime: string;
  readonly totalCases: number;
  readonly totalCuts: number;
  readonly passingCases: number;
  readonly failingCases: number;
  readonly passingCuts: number;
  readonly failingCuts: number;
  readonly byFamily: Record<
    Family,
    {
      cases: number;
      passingCases: number;
      failingCases: number;
      cuts: number;
      passingCuts: number;
      failingCuts: number;
    }
  >;
}

interface MutationRecord {
  readonly specId: string;
  readonly family: Family;
  readonly mutation: string;
  readonly semantic: boolean;
  readonly detected: boolean;
  readonly rawDeepDiffDetected: boolean;
  readonly stage?: CutResult["stage"];
  readonly error?: string;
}

interface ShrinkRecord {
  readonly runtime: string;
  readonly specId: string;
  readonly family: Family;
  readonly originalTraceLength: number;
  readonly reducedTraceLength: number;
  readonly reducedTrace: readonly BenchmarkStep[];
  readonly firstFailingCut: number;
  readonly stage?: CutResult["stage"];
}

const runtimes: readonly RuntimeAdapter[] = [
  { id: "xstate-5.19.2", label: "XState 5.19.2", generation: "v5", xs: x5192 as any },
  { id: "xstate-5.33.2", label: "XState 5.33.2", generation: "v5", xs: x5332 as any },
  { id: "xstate-6.0.0-alpha.63", label: "XState 6.0.0-alpha.63", generation: "v6", xs: x6prev as any },
  { id: "xstate-6.0.0-alpha.64", label: "XState 6.0.0-alpha.64", generation: "v6", xs: x6 as any },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function int(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function generateCorpus(count = 120, seed = BENCHMARK_SEED): CorpusSpec[] {
  const random = mulberry32(seed);
  const families: readonly Family[] = [
    "linear",
    "context",
    "guarded",
    "history",
    "timer",
    "child",
  ];
  return Array.from({ length: count }, (_, index) => {
    const family = families[index % families.length]!;
    return {
      id: family + "-" + String(index).padStart(3, "0"),
      family,
      variant: index,
      depth: int(random, 2, 5),
      threshold: int(random, 1, 4),
      delay: int(random, 5, 30) * 10,
    };
  });
}

function transition(target: string): { target: string } {
  return { target };
}

function compileCase(adapter: RuntimeAdapter, spec: CorpusSpec): CompiledCase {
  const xs = adapter.xs;
  const v6 = adapter.generation === "v6";

  if (spec.family === "linear") {
    const states: Record<string, any> = {};
    for (let index = 0; index < spec.depth; index++) {
      const key = "s" + index;
      states[key] =
        index === spec.depth - 1
          ? { type: "final" }
          : { on: { NEXT: transition("s" + (index + 1)) } };
    }
    return {
      spec,
      logic: xs.createMachine({ id: spec.id, initial: "s0", states } as any),
      trace: Array.from(
        { length: spec.depth - 1 },
        () => ({ kind: "event", event: { type: "NEXT" } }) as const,
      ),
    };
  }

  if (spec.family === "context") {
    const update = v6
      ? { context: ({ context }: any) => ({ count: context.count + 1 }) }
      : {
          actions: xs.assign({
            count: ({ context }: any) => context.count + 1,
          }),
        };
    return {
      spec,
      logic: xs.createMachine({
        id: spec.id,
        context: { count: 0 },
        initial: "active",
        states: {
          active: { on: { INC: update, DONE: transition("done") } },
          done: { type: "final" },
        },
      } as any),
      trace: [
        ...Array.from(
          { length: spec.threshold + 1 },
          () => ({ kind: "event", event: { type: "INC" } }) as const,
        ),
        { kind: "event", event: { type: "DONE" } },
      ],
    };
  }

  if (spec.family === "guarded") {
    const update = v6
      ? { context: ({ context }: any) => ({ count: context.count + 1 }) }
      : {
          actions: xs.assign({
            count: ({ context }: any) => context.count + 1,
          }),
        };
    return {
      spec,
      logic: xs.createMachine({
        id: spec.id,
        context: { count: 0 },
        initial: "collecting",
        states: {
          collecting: {
            on: {
              INC: update,
              GO: {
                target: "done",
                guard: ({ context }: any) => context.count >= spec.threshold,
              },
            },
          },
          done: { type: "final" },
        },
      } as any),
      trace: [
        ...Array.from(
          { length: spec.threshold },
          () => ({ kind: "event", event: { type: "INC" } }) as const,
        ),
        { kind: "event", event: { type: "GO" } },
      ],
    };
  }

  if (spec.family === "history") {
    const nested: Record<string, any> = {
      hist: {
        id: spec.id + "-history",
        type: "history",
        history: "deep",
        ...(v6 ? { target: "n0" } : {}),
      },
    };
    for (let index = 0; index < spec.depth; index++) {
      nested["n" + index] =
        index === spec.depth - 1
          ? {}
          : { on: { NEXT: transition("n" + (index + 1)) } };
    }
    return {
      spec,
      logic: xs.createMachine({
        id: spec.id,
        initial: "editing",
        states: {
          editing: {
            initial: "n0",
            states: nested,
            on: { LEAVE: transition("review") },
          },
          review: {
            on: { BACK: transition("#" + spec.id + "-history") },
          },
        },
      } as any),
      trace: [
        ...Array.from(
          { length: Math.max(1, spec.depth - 1) },
          () => ({ kind: "event", event: { type: "NEXT" } }) as const,
        ),
        { kind: "event", event: { type: "LEAVE" } },
        { kind: "event", event: { type: "BACK" } },
      ],
    };
  }

  if (spec.family === "timer") {
    return {
      spec,
      logic: xs.createMachine({
        id: spec.id,
        initial: "idle",
        states: {
          idle: { on: { START: transition("waiting") } },
          waiting: { after: { [spec.delay]: transition("done") } },
          done: { type: "final" },
        },
      } as any),
      trace: [
        { kind: "event", event: { type: "START" } },
        { kind: "advance", ms: spec.delay },
      ],
    };
  }

  const childKey = "worker-" + spec.variant;
  const child = xs.createMachine({
    id: spec.id + "-child",
    initial: "idle",
    states: {
      idle: { on: { PING: transition("active") } },
      active: { on: { PING: transition("idle") } },
    },
  } as any);
  const invoke = v6
    ? { src: "worker", id: "worker", registryKey: childKey }
    : { src: "worker", id: "worker", systemId: childKey };
  const setup = xs.setup({ actors: { worker: child } });
  return {
    spec,
    logic: setup.createMachine({
      id: spec.id,
      initial: "running",
      states: {
        running: { invoke },
      },
    } as any),
    trace: [
      {
        kind: "child-event",
        key: childKey,
        event: { type: "PING" },
      },
      {
        kind: "child-event",
        key: childKey,
        event: { type: "PING" },
      },
    ],
  };
}

function createRun(adapter: RuntimeAdapter, logic: any, snapshot?: unknown): ActorRun {
  const clock = new adapter.xs.SimulatedClock();
  const actor = adapter.xs.createActor(
    logic,
    { clock, ...(snapshot !== undefined ? { snapshot } : {}) } as any,
  );
  actor.subscribe?.({ error: () => {} });
  actor.start();
  return { actor, clock };
}

function apply(run: ActorRun, step: BenchmarkStep): void {
  if (step.kind === "advance") {
    run.clock.increment(step.ms);
    return;
  }
  if (step.kind === "child-event") {
    const child = run.actor.system.get(step.key);
    if (!child) {
      throw new Error("Missing registered child actor: " + step.key);
    }
    child.send(step.event);
    return;
  }
  run.actor.send(step.event);
}

function roundTrip(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

function executeCut(
  adapter: RuntimeAdapter,
  compiled: CompiledCase,
  cut: number,
  mutate?: (snapshot: any, spec: CorpusSpec) => any,
): CutResult {
  const control = createRun(adapter, compiled.logic);
  try {
    const prefix = compiled.trace.slice(0, cut);
    const suffix = compiled.trace.slice(cut);
    for (const step of prefix) apply(control, step);

    const controlIndex = decisionStateIndex(control.actor);
    let persisted = roundTrip(control.actor.getPersistedSnapshot());
    if (mutate) persisted = mutate(roundTrip(persisted), compiled.spec);

    let restored: ActorRun;
    try {
      restored = createRun(adapter, compiled.logic, persisted);
    } catch (caught) {
      return {
        passed: false,
        hydrationEquivalent: false,
        repersistenceEquivalent: false,
        continuationEquivalent: false,
        control: controlIndex,
        restored: controlIndex,
        persistedSnapshot: persisted,
        stage: "restore-error",
        error: caught instanceof Error ? caught.message : String(caught),
        cut,
      };
    }

    try {
      const consumedMs = prefix.reduce(
        (sum, step) => sum + (step.kind === "advance" ? step.ms : 0),
        0,
      );
      if (consumedMs > 0 && typeof restored.clock.set === "function") {
        restored.clock.set(consumedMs);
      }

      const hydratedIndex = decisionStateIndex(restored.actor);
      const hydration = compareDecisionStateIndexes(controlIndex, hydratedIndex);

      let repersistenceEquivalent = false;
      let persistedAgain: any | undefined;
      let repersistError: string | undefined;
      try {
        persistedAgain = roundTrip(restored.actor.getPersistedSnapshot());
        const twice = createRun(adapter, compiled.logic, persistedAgain);
        try {
          repersistenceEquivalent = compareDecisionStateIndexes(
            hydratedIndex,
            decisionStateIndex(twice.actor),
          ).equivalent;
        } finally {
          twice.actor.stop();
        }
      } catch (caught) {
        repersistError =
          caught instanceof Error ? caught.message : String(caught);
      }

      let continuationEquivalent = true;
      let suffixOffset: number | undefined;
      for (let index = 0; index < suffix.length; index++) {
        apply(control, suffix[index]!);
        apply(restored, suffix[index]!);
        const comparison = compareDecisionStateIndexes(
          decisionStateIndex(control.actor),
          decisionStateIndex(restored.actor),
        );
        if (!comparison.equivalent) {
          continuationEquivalent = false;
          suffixOffset = index;
          break;
        }
      }

      const passed =
        hydration.equivalent &&
        repersistenceEquivalent &&
        continuationEquivalent;
      const stage = !hydration.equivalent
        ? "hydrate"
        : !repersistenceEquivalent
          ? "repersist"
          : !continuationEquivalent
            ? "continuation"
            : undefined;

      return {
        passed,
        hydrationEquivalent: hydration.equivalent,
        repersistenceEquivalent,
        continuationEquivalent,
        control: controlIndex,
        restored: hydratedIndex,
        persistedSnapshot: persisted,
        ...(persistedAgain !== undefined ? { persistedAgain } : {}),
        ...(stage ? { stage } : {}),
        ...(repersistError ? { error: repersistError } : {}),
        cut,
        ...(suffixOffset !== undefined ? { suffixOffset } : {}),
      };
    } finally {
      restored.actor.stop();
    }
  } finally {
    control.actor.stop();
  }
}

function runCase(adapter: RuntimeAdapter, compiled: CompiledCase): readonly CutResult[] {
  return Array.from(
    { length: compiled.trace.length + 1 },
    (_, cut) => executeCut(adapter, compiled, cut),
  );
}

function emptyFamilySummary() {
  return {
    cases: 0,
    passingCases: 0,
    failingCases: 0,
    cuts: 0,
    passingCuts: 0,
    failingCuts: 0,
  };
}

function summarizeRuntime(
  adapter: RuntimeAdapter,
  corpus: readonly CorpusSpec[],
): RuntimeSummary {
  const families = {
    linear: emptyFamilySummary(),
    context: emptyFamilySummary(),
    guarded: emptyFamilySummary(),
    history: emptyFamilySummary(),
    timer: emptyFamilySummary(),
    child: emptyFamilySummary(),
  };

  let totalCuts = 0;
  let passingCuts = 0;
  let passingCases = 0;

  for (const spec of corpus) {
    const compiled = compileCase(adapter, spec);
    const results = runCase(adapter, compiled);
    const family = families[spec.family];
    family.cases += 1;
    family.cuts += results.length;
    totalCuts += results.length;

    const casePass = results.every((result) => result.passed);
    if (casePass) {
      passingCases += 1;
      family.passingCases += 1;
    } else {
      family.failingCases += 1;
    }

    for (const result of results) {
      if (result.passed) {
        passingCuts += 1;
        family.passingCuts += 1;
      } else {
        family.failingCuts += 1;
      }
    }
  }

  return {
    runtime: adapter.id,
    totalCases: corpus.length,
    totalCuts,
    passingCases,
    failingCases: corpus.length - passingCases,
    passingCuts,
    failingCuts: totalCuts - passingCuts,
    byFamily: families,
  };
}

function mutationCut(compiled: CompiledCase): number {
  if (compiled.spec.family === "history") return compiled.trace.length - 1;
  if (compiled.spec.family === "guarded") {
    return Math.max(1, compiled.spec.threshold);
  }
  return 1;
}

function semanticMutation(snapshot: any, spec: CorpusSpec): any {
  if (spec.family === "linear") {
    snapshot.value = "s0";
  } else if (spec.family === "context" || spec.family === "guarded") {
    snapshot.context = {
      ...(snapshot.context ?? {}),
      count: Number(snapshot.context?.count ?? 0) + 1000,
    };
  } else if (spec.family === "history") {
    snapshot.historyValue = {};
  } else if (spec.family === "timer") {
    if (snapshot.timers && typeof snapshot.timers === "object") snapshot.timers = {};
    else snapshot.value = "idle";
  } else if (snapshot.children?.worker?.snapshot) {
    const current = snapshot.children.worker.snapshot.value;
    snapshot.children.worker.snapshot.value =
      current === "active" ? "idle" : "active";
  } else {
    snapshot.children = {};
  }
  return snapshot;
}

function representationNoop(snapshot: any, spec: CorpusSpec): any {
  snapshot.__benchmarkMetadata = {
    seed: BENCHMARK_SEED,
    case: spec.id,
    note: "ignored top-level benchmark metadata",
  };
  return snapshot;
}

function runMutations(
  adapter: RuntimeAdapter,
  corpus: readonly CorpusSpec[],
) {
  const records: MutationRecord[] = [];
  for (const spec of corpus) {
    const compiled = compileCase(adapter, spec);
    const cut = mutationCut(compiled);
    const baseline = executeCut(adapter, compiled, cut);

    const semantic = executeCut(adapter, compiled, cut, semanticMutation);
    records.push({
      specId: spec.id,
      family: spec.family,
      mutation: "semantic-" + spec.family,
      semantic: true,
      detected: !semantic.passed,
      rawDeepDiffDetected:
        stableStringify(baseline.persistedSnapshot) !==
        stableStringify(semantic.persistedSnapshot),
      ...(semantic.stage ? { stage: semantic.stage } : {}),
      ...(semantic.error ? { error: semantic.error } : {}),
    });

    const noop = executeCut(adapter, compiled, cut, representationNoop);
    records.push({
      specId: spec.id,
      family: spec.family,
      mutation: "representation-noop",
      semantic: false,
      detected: !noop.passed,
      rawDeepDiffDetected:
        stableStringify(baseline.persistedSnapshot) !==
        stableStringify(noop.persistedSnapshot),
      ...(noop.stage ? { stage: noop.stage } : {}),
      ...(noop.error ? { error: noop.error } : {}),
    });
  }

  const semanticRecords = records.filter((record) => record.semantic);
  const noopRecords = records.filter((record) => !record.semantic);
  return {
    records,
    semanticKilled: semanticRecords.filter((record) => record.detected).length,
    semanticTotal: semanticRecords.length,
    noopFalsePositives: noopRecords.filter((record) => record.detected).length,
    noopTotal: noopRecords.length,
    rawSemanticDetected: semanticRecords.filter(
      (record) => record.rawDeepDiffDetected,
    ).length,
    rawSemanticTotal: semanticRecords.length,
    rawNoopFalsePositives: noopRecords.filter(
      (record) => record.rawDeepDiffDetected,
    ).length,
    rawNoopTotal: noopRecords.length,
  };
}

function firstFailure(
  adapter: RuntimeAdapter,
  compiled: CompiledCase,
): CutResult | undefined {
  return runCase(adapter, compiled).find((result) => !result.passed);
}

function shrinkTrace(
  adapter: RuntimeAdapter,
  compiled: CompiledCase,
): ShrinkRecord | undefined {
  if (!firstFailure(adapter, compiled)) return undefined;
  let trace = [...compiled.trace];
  let changed = true;

  while (changed && trace.length > 1) {
    changed = false;
    for (let index = 0; index < trace.length; index++) {
      const candidate = trace.filter((_, itemIndex) => itemIndex !== index);
      if (candidate.length === 0) continue;
      const failure = firstFailure(adapter, { ...compiled, trace: candidate });
      if (failure) {
        trace = candidate;
        changed = true;
        break;
      }
    }
  }

  const reducedFailure = firstFailure(adapter, { ...compiled, trace });
  if (!reducedFailure) return undefined;
  return {
    runtime: adapter.id,
    specId: compiled.spec.id,
    family: compiled.spec.family,
    originalTraceLength: compiled.trace.length,
    reducedTraceLength: trace.length,
    reducedTrace: trace,
    firstFailingCut: reducedFailure.cut,
    ...(reducedFailure.stage ? { stage: reducedFailure.stage } : {}),
  };
}

function benchmarkMarkdown(report: any): string {
  const lines = [
    "# Generated Persistence Conformance Corpus",
    "",
    "**Observed:** " + report.observed,
    "**Seed:** " + report.seed,
    "**Generated cases:** " + report.corpusSize,
    "**Families:** linear, context, guarded, history, timer, child",
    "",
    "## Cross-version matrix",
    "",
    "| Runtime | Passing cases | Passing cuts | History family | Timer family |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const row of report.runtimeMatrix as RuntimeSummary[]) {
    lines.push(
      "| " + row.runtime +
      " | " + row.passingCases + "/" + row.totalCases +
      " | " + row.passingCuts + "/" + row.totalCuts +
      " | " + row.byFamily.history.passingCases + "/" + row.byFamily.history.cases +
      " | " + row.byFamily.timer.passingCases + "/" + row.byFamily.timer.cases +
      " |",
    );
  }
  lines.push(
    "",
    "The corpus is generated from one frozen seed and one abstract family definition. Runtime-specific compilers translate the same semantic families to XState v5 and v6 syntax.",
    "",
    "## Mutation score",
    "",
    "Mutation target: **" + report.mutations.runtime + "**.",
    "",
    "| Comparator | Semantic mutations detected | Representation no-op false positives |",
    "| --- | ---: | ---: |",
    "| DSI conformance | " + report.mutations.semanticKilled + "/" + report.mutations.semanticTotal + " | " + report.mutations.noopFalsePositives + "/" + report.mutations.noopTotal + " |",
    "| Raw persisted deep diff | " + report.mutations.rawSemanticDetected + "/" + report.mutations.rawSemanticTotal + " | " + report.mutations.rawNoopFalsePositives + "/" + report.mutations.rawNoopTotal + " |",
    "",
    "Semantic mutations deliberately change decision-relevant state: active state, context/guard input, history, timers, or child state. Representation-only mutations add ignored top-level metadata and should not change behavior.",
    "",
    "## Automatic reduction",
    "",
  );
  for (const row of report.shrinks as ShrinkRecord[]) {
    lines.push(
      "- " + row.runtime + " / " + row.specId + " (" + row.family + "): " +
      row.originalTraceLength + " steps -> **" + row.reducedTraceLength +
      "**; first failing cut " + row.firstFailingCut +
      "; stage " + (row.stage ?? "unknown") + ".",
    );
  }
  lines.push(
    "",
    "The reducer removes trace steps while preserving a conformance failure. It does not rewrite machine logic or add issue-specific knowledge.",
    "",
    "## Interpretation",
    "",
    "This benchmark tests whether the Decision State Index generalizes beyond hand-selected public issues.",
    "",
    "The useful signal is the combination of expected version-specific failure families, semantic mutation sensitivity, low false positives on representation-only changes, adjacent-v6 stability, and reduction to an issue-sized trace.",
    "",
    "See generated-corpus-results.json for the full machine-readable result.",
    "",
  );
  return lines.join("\n");
}

export function runBenchmark(
  count = 120,
  seed = BENCHMARK_SEED,
): any {
  const corpus = generateCorpus(count, seed);
  const runtimeMatrix = runtimes.map((adapter) => summarizeRuntime(adapter, corpus));
  const mutationAdapter = runtimes.find(
    (adapter) => adapter.id === "xstate-6.0.0-alpha.64",
  )!;
  const mutationRun = runMutations(mutationAdapter, corpus);

  const v5192 = runtimes.find((runtime) => runtime.id === "xstate-5.19.2")!;
  const v5332 = runtimes.find((runtime) => runtime.id === "xstate-5.33.2")!;
  const historySpec = corpus.find((spec) => spec.family === "history")!;
  const timerSpec = corpus.find((spec) => spec.family === "timer")!;
  const shrinks = [
    shrinkTrace(v5192, compileCase(v5192, historySpec)),
    shrinkTrace(v5332, compileCase(v5332, timerSpec)),
  ].filter((value): value is ShrinkRecord => value !== undefined);

  return {
    schema: BENCHMARK_SCHEMA,
    observed: "2026-10-04",
    seed,
    corpusSize: corpus.length,
    corpus,
    runtimeMatrix,
    mutations: {
      runtime: mutationAdapter.id,
      semanticKilled: mutationRun.semanticKilled,
      semanticTotal: mutationRun.semanticTotal,
      noopFalsePositives: mutationRun.noopFalsePositives,
      noopTotal: mutationRun.noopTotal,
      rawSemanticDetected: mutationRun.rawSemanticDetected,
      rawSemanticTotal: mutationRun.rawSemanticTotal,
      rawNoopFalsePositives: mutationRun.rawNoopFalsePositives,
      rawNoopTotal: mutationRun.rawNoopTotal,
      records: mutationRun.records,
    },
    shrinks,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const report = runBenchmark();
  const outputDir = resolve(process.cwd(), "research");
  writeFileSync(
    resolve(outputDir, "generated-corpus-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(
    resolve(outputDir, "GENERATED-CORPUS.md"),
    benchmarkMarkdown(report),
  );
  process.stdout.write(
    JSON.stringify(
      {
        corpusSize: report.corpusSize,
        runtimeMatrix: report.runtimeMatrix,
        mutations: {
          runtime: report.mutations.runtime,
          semanticKilled: report.mutations.semanticKilled,
          semanticTotal: report.mutations.semanticTotal,
          noopFalsePositives: report.mutations.noopFalsePositives,
          noopTotal: report.mutations.noopTotal,
          rawSemanticDetected: report.mutations.rawSemanticDetected,
          rawSemanticTotal: report.mutations.rawSemanticTotal,
          rawNoopFalsePositives: report.mutations.rawNoopFalsePositives,
          rawNoopTotal: report.mutations.rawNoopTotal,
        },
        shrinks: report.shrinks,
      },
      null,
      2,
    ) + "\n",
  );
}
