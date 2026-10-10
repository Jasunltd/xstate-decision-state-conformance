# Public XState Persistence Issue Matrix

**Observed:** 2026-10-04  
**Primary stable runtime:** XState 5.33.2  
**Historical aliases:** XState 5.18.1, 5.19.2  
**Forward control:** XState 6.0.0-alpha.64

This matrix is the first external-validity gate for the Decision State Index (DSI) persistence checker.

The goal is not to claim every open issue is still unfixed. The goal is to test whether one generic conformance model can:

1. recover historical failures on pinned historical versions;
2. distinguish fixed behavior on current versions;
3. detect current persistence boundaries without issue-specific checker logic;
4. show value over raw persisted-snapshot equality and visible state equality.

## Results

| Public report | Failure class | Historical result | XState 5.33.2 | Detection channel |
| --- | --- | --- | --- | --- |
| #5178 | serialized history restoration | **reproduced on 5.19.2** | **green** | bounded continuation |
| #5077 | restored child cannot be persisted again | **reproduced on 5.18.1** | **still reproduced** | re-persistence closure |
| #4873 | restored system child becomes unusable | public source shape reproduced | **still reproduced** | routed continuation / runtime error |
| #5331 | delayed transition lost after restore | v5 issue | **still reproduced** | DSI scheduled obligation |
| v6 timer control | logical timer persistence | n/a | n/a | **green on 6.0.0-alpha.63/.64** |
| v6 migration control | machine-version snapshot migration | n/a | n/a | **green on 6.0.0-alpha.64** |
| v6 address/registry control | stable actor identity + routed continuation | n/a | n/a | **green on 6.0.0-alpha.63/.64** |

## #5178 — history semantics

Source: https://github.com/statelyai/xstate/issues/5178

The issue reports that JSON serialization turns the historical StateNode payload into plain data. The hydrated machine still appears to carry the expected history value, but a later transition through the history node returns to the initial child instead of the remembered child.

Observed:

- XState 5.19.2 reproduces the failure.
- XState 5.33.2 returns to the remembered state correctly.
- On 5.19.2, the persisted snapshot before restore and the persisted snapshot immediately after restore are JSON-equal.
- The visible state at hydration is also equal.
- The divergence appears only when the suffix consumes history.

Implication:

> Hydration-time equality is necessary but not sufficient. Continuation semantics are part of persistence conformance.

## #5077 — re-persistence closure

Source: https://github.com/statelyai/xstate/issues/5077

The public report describes:

1. create/spawn child actors;
2. persist;
3. JSON serialize/parse;
4. restore;
5. call `getPersistedSnapshot()` again;
6. restored child persistence throws.

Observed with a minimal dynamic spawned-child source shape:

- XState 5.18.1 reproduces `this.logic.getPersistedSnapshot is not a function`.
- XState 5.33.2 reproduces the same failure class.

The checker therefore treats **persistence closure** as a first-class invariant:

```text
persist
-> hydrate
-> persist again
-> hydrate again
```

The restored actor must remain persistable and preserve the same DSI.

## #4873 — restored system actor usability

Source: https://github.com/statelyai/xstate/issues/4873

The report dynamically creates a child machine, spawns it with a system ID, serializes/restores the parent, then routes an event through `system.get(id)`.

Observed on XState 5.33.2:

- `system.get(id)` returns an entry after restore;
- routing an event to that restored child produces `this.logic.transition is not a function`;
- the root actor enters error state.

This is not merely an identity lookup invariant:

> A restored address/registry entry must resolve to an operationally equivalent actor.

The generic bounded-continuation surface catches this class.

## #5331 — delayed transition obligation

Source: https://github.com/statelyai/xstate/issues/5331

Observed on XState 5.33.2:

- control and restored actors both visibly occupy `"waiting"`;
- the persisted snapshot can be JSON-round-tripped and re-persisted with deep equality;
- the control actor has one pending `after` obligation;
- the restored actor has none;
- the restored machine therefore cannot take the future delayed transition.

This is the strongest V1 argument for DSI over raw persistence diff:

```text
persisted snapshot equality: PASS
visible state equality:      PASS
Decision State Index:        FAIL
future behavior:              FAIL
```

## XState v6 alpha control

Current v6 persistence documentation makes timers part of the public persisted actor contract.

Observed on XState 6.0.0-alpha.64:

- the persisted snapshot contains a logical `timers` map;
- DSI sees the timer before and after hydration;
- with `SimulatedClock`, restore intentionally starts the full declared delay because a custom clock's epoch is not portable;
- after the full restored delay, the transition fires;
- with the default wall clock, persisted timers carry `startedAt`.

This is a useful forward control: the same DSI concept that flags the v5 missing obligation recognizes the v6 logical timer as preserved.

Additional v6 controls also remain green:

- `machineVersions().migrateSnapshot()` produces a v2 actor whose DSI matches independently constructed v2 semantics and remains equivalent after a target-version event;
- child `address` and `registryKey` remain stable and operational across persistence, including re-persistence;
- timer and address/registry categories remain green without DSI changes on both alpha.63 and alpha.64.

These controls align with v6's public persistence contract: machine versions are explicitly migratable, children carry stable addresses, and registry identity uses `registryKey`.

## Comparator interpretation

### Visible state only

Misses:

- #5178 at hydration;
- #5331 at hydration.

### Raw persisted-snapshot deep equality

Misses:

- #5178 historical failure;
- #5331 current v5 failure.

### DSI at hydration

Catches:

- #5331 immediately.

Does not by itself catch:

- #5178, because the serialized history payload still names the correct semantic state.

### DSI + re-persistence + bounded continuation

Covers all retained failure classes in the current matrix:

- state projection;
- history consumption;
- child persistence closure;
- actor routing/runtime viability;
- delayed obligations.

## Current decision

V1 passes its first external-validity gate.

It has recovered multiple independently reported persistence/rehydration failure classes without adding issue-specific rules to the checker and has distinguished at least one historical defect from current fixed behavior.

The next gate is not more synthetic cases. It is:

1. shrink each public report to a generated counterexample artifact;
2. add raw-diff and continuation-only comparators as executable treatments;
3. add v6 machine-version migration cases;
4. test whether DSI remains stable across another XState minor/alpha without private-field expansion.

## Sources

- https://github.com/statelyai/xstate/issues/5178
- https://github.com/statelyai/xstate/issues/5077
- https://github.com/statelyai/xstate/issues/4873
- https://github.com/statelyai/xstate/issues/5331
- https://dev.stately.ai/docs/xstate/v6/persistence
