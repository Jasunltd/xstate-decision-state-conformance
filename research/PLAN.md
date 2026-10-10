# Research plan

## Primary question

Can a Decision State Index expose persistence/hydration divergences that are semantically meaningful to an XState actor's future behavior while avoiding brittle raw-snapshot comparison?

## V1 hypotheses

H1. State-value/context round-trip equivalence is insufficient because future obligations can diverge while visible state remains equal.

H2. A small projection of decision-relevant runtime state can detect those failures.

H3. Bounded continuation comparison can distinguish harmless serialization differences from behaviorally meaningful divergence.

## Initial population

- ordinary finite state/context continuation — expected green;
- deep history continuation — expected green on current stable;
- invoked child topology/continuation — expected green on current stable;
- delayed transition obligation — expected divergence if scheduler state is not persisted.

## Success gate

V1 earns expansion if it:

1. has zero false failures on the green fixtures;
2. detects at least one real current/historical persistence boundary where visible state equality alone would miss the problem;
3. emits a counterexample with cut point, first divergence stage, and precise decision-state paths.

Otherwise archive it.

## Completed gates

The bounded pass now includes:

- public issue reproductions for history, child re-persistence, restored actor usability, and delayed transitions;
- re-persistence-after-hydration closure;
- executable visible-state / raw-persisted / DSI / continuation comparators;
- machine-readable counterexample artifacts;
- v6-alpha persisted timer controls;
- v6 machine-version migration conformance against native target semantics;
- v6 stable actor address/registry conformance;
- unchanged DSI-category stability across alpha.63 and alpha.64;
- a frozen 120-machine generated corpus across six semantic families;
- 1,944 all-cut cross-version persistence checks;
- paired semantic and representation-only mutation controls;
- automatic failing-trace reduction.

## Stop / reopen rule

The planned V1 gates are complete. Do not manufacture more cases.

Reopen only for a new independent XState persistence failure, a maintainer request, or a stable-v6 contract change.
