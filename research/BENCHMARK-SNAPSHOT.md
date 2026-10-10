# Benchmark Snapshot — Generated Persistence Conformance Corpus

**Date:** 2026-10-04  
**Seed:** 334462  
**Generated machines:** 120  
**Families:** linear, context, guarded, history, timer, child  
**Pinned runtimes:** XState 5.19.2, 5.33.2, 6.0.0-alpha.63, 6.0.0-alpha.64

## Scope

The benchmark is deliberately generated from one frozen abstract corpus rather than from the four hand-selected public issues.

Each runtime receives the same semantic families through a small version adapter. Every trace is persisted at every cut point.

Total evaluated persistence cuts:

- 486 per runtime;
- **1,944 cross-version persistence cuts** total.

The six families cover:

- linear/terminal state flow;
- context mutation;
- context-dependent guards;
- nested deep history;
- delayed transitions;
- registered child actor state and routing.

## Cross-version result

| Runtime | Passing generated cases | Passing cuts | History | Timers |
| --- | ---: | ---: | ---: | ---: |
| XState 5.19.2 | 80 / 120 | 446 / 486 | 0 / 20 | 0 / 20 |
| XState 5.33.2 | 100 / 120 | 466 / 486 | 20 / 20 | 0 / 20 |
| XState 6.0.0-alpha.63 | **120 / 120** | **486 / 486** | 20 / 20 | 20 / 20 |
| XState 6.0.0-alpha.64 | **120 / 120** | **486 / 486** | 20 / 20 | 20 / 20 |

The generated result independently recovers the same version distinctions as the public-issue study:

- historical history semantics fail on 5.19.2 and are green on 5.33.2;
- v5 delayed-transition persistence fails on both tested v5 versions;
- both tested v6 alphas preserve the generated timer/history cases;
- ordinary linear, context, guard and registered-child families stay green on their supported runtime mappings.

## Mutation / specificity result

Mutation target: **XState 6.0.0-alpha.64**.

Each of the 120 generated cases receives:

1. one semantic mutation that changes decision-relevant persisted state; and
2. one representation-only mutation that adds ignored top-level metadata.

| Comparator | Semantic mutations detected | Representation-only false positives |
| --- | ---: | ---: |
| **DSI conformance** | **120 / 120** | **0 / 120** |
| Raw persisted deep diff | 120 / 120 | **120 / 120** |

The raw diff has equal sensitivity on this mutation set but no specificity: every harmless metadata-only change is reported.

The DSI kills every semantic mutation in the frozen set while ignoring every representation-only change.

## Automatic reduction

Two generated failures were passed through the trace reducer without issue-specific knowledge.

### Historical history failure

XState 5.19.2 / generated case `history-003`:

- original trace: 5 steps;
- reduced trace: **3 steps**;
- minimal retained sequence: `NEXT -> LEAVE -> BACK`;
- first failing cut: 2;
- divergence stage: continuation.

### v5 delayed-transition failure

XState 5.33.2 / generated case `timer-004`:

- original trace: 2 steps;
- reduced trace: **1 step**;
- retained sequence: `START`;
- first failing cut: 1;
- divergence stage: hydration.

The reducer removes trace steps while preserving the conformance failure. It does not rewrite machine logic or encode XState issue numbers.

## Pre-fix benchmark diagnostic

The first complete generated matrix is retained as:

- `generated-corpus-results.pre-fix.json`
- `GENERATED-CORPUS.pre-fix.md`

That run showed 20/20 v6 child-family failures and 20/120 representation-no-op false positives.

Diagnosis: the benchmark compiler used a v5-style parent action callback shape for child routing, which put the v6 parent into error before persistence. The DSI correctly observed the error-state difference; the benchmark transport was invalid.

The repair changed only the generated trace transport to a runtime-neutral public registry send (`child-event`). It did not change DSI categories, comparator logic, seed, corpus size, mutation policy or XState versions.

The first post-fix retained matrix is the result above.

## Interpretation

This materially strengthens the project beyond a collection of bug reproductions.

The retained signal is now:

> One small decision-state model recovers known version-specific persistence failures, stays green on repaired v6 semantics, detects 120/120 generated semantic corruptions with 0/120 representation-only false positives, and automatically shrinks generated failures into issue-sized traces.

This is still a bounded research corpus, not proof of persistence correctness for arbitrary actor systems.
