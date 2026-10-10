# Generated Persistence Conformance Corpus

**Observed:** 2026-10-04
**Seed:** 334462
**Generated cases:** 120
**Families:** linear, context, guarded, history, timer, child

## Cross-version matrix

| Runtime | Passing cases | Passing cuts | History family | Timer family |
| --- | ---: | ---: | ---: | ---: |
| xstate-5.19.2 | 80/120 | 446/486 | 0/20 | 0/20 |
| xstate-5.33.2 | 100/120 | 466/486 | 20/20 | 0/20 |
| xstate-6.0.0-alpha.63 | 100/120 | 446/486 | 20/20 | 20/20 |
| xstate-6.0.0-alpha.64 | 100/120 | 446/486 | 20/20 | 20/20 |

The corpus is generated from one frozen seed and one abstract family definition. Runtime-specific compilers translate the same semantic families to XState v5 and v6 syntax.

## Mutation score

Mutation target: **xstate-6.0.0-alpha.64**.

- semantic mutations killed: **120/120**;
- representation-only no-op false positives: **20/120**.

Semantic mutations deliberately change decision-relevant state: active state, context/guard input, history, timers, or child state. Representation-only mutations add ignored top-level metadata and should not change behavior.

## Automatic reduction

- xstate-5.19.2 / history-003 (history): 5 steps -> **3**; first failing cut 2; stage continuation.
- xstate-5.33.2 / timer-004 (timer): 2 steps -> **1**; first failing cut 1; stage hydrate.

The reducer removes trace steps while preserving a conformance failure. It does not rewrite machine logic or add issue-specific knowledge.

## Interpretation

This benchmark tests whether the Decision State Index generalizes beyond hand-selected public issues.

The useful signal is the combination of expected version-specific failure families, semantic mutation sensitivity, low false positives on representation-only changes, adjacent-v6 stability, and reduction to an issue-sized trace.

See generated-corpus-results.json for the full machine-readable result.
