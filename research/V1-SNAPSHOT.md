# V1 Measurement Snapshot

**Date:** 2026-10-04
**Primary stable runtime:** XState 5.33.2
**Historical controls:** XState 5.18.1, 5.19.2
**Forward controls:** XState 6.0.0-alpha.63 and 6.0.0-alpha.64
**Node:** 22.x

## Implemented V1

- canonical Decision State Index projection;
- generated/session actor identity exclusion;
- active state/context/status/output/error projection;
- history-state normalization;
- child actor topology and child-state projection;
- XState v5 scheduled-event obligation projection;
- XState v6 public logical-timer projection;
- persist -> JSON -> hydrate check;
- re-persistence closure check;
- bounded continuation replay;
- all-cut trace checking;
- actor-error capture as conformance state rather than process abort;
- first-divergence report;
- CLI scenario runner.

## Current validation

`npm test`:

- **20 tests**;
- **20 passing**;
- **0 failing**.

### Green controls

1. basic state/context continuation across every trace cut;
2. current-stable deep-history continuation;
3. invoked-child topology and child event continuation;
4. stable DSI projection for unchanged actor;
5. XState v6 alpha logical timer survives hydration under a simulated clock;
6. XState v6 alpha default wall-clock persistence stamps timer `startedAt`.

### Public issue reproductions / version distinctions

#### #5178 — history restoration

- XState 5.19.2: **reproduced**.
- XState 5.33.2: **green** in the retained minimal reproduction.
- Raw persisted snapshot before/after hydration is JSON-equal on 5.19.2.
- Visible state at hydration is equal.
- DSI history projection at hydration is equal.
- A later transition through the history node diverges.

This demonstrates why bounded continuation is required in addition to hydration-time state comparison.

#### #5077 — restored child re-persistence

- XState 5.18.1: **reproduced**.
- XState 5.33.2: **reproduced** in the retained dynamic spawned-child shape.
- Restored `getPersistedSnapshot()` fails with `this.logic.getPersistedSnapshot is not a function`.

The checker now treats persistence closure as an invariant:

```text
persist -> hydrate -> persist again -> hydrate again
```

#### #4873 — system actor after serialized restore

- XState 5.33.2: **reproduced** with the public source shape.
- `system.get(id)` returns an entry after restore.
- Routing an event to that entry causes `this.logic.transition is not a function`.
- The root actor enters error state.

This makes operational actor usability—not mere lookup presence—part of bounded continuation conformance.

#### #5331 — delayed transition persistence

- XState 5.33.2: **reproduced**.
- Control and restored actors both visibly report `"waiting"`.
- The persisted snapshot can be JSON-round-tripped and re-persisted with deep equality.
- Control has one scheduled delayed-transition obligation.
- Restored has zero.
- DSI flags the divergence immediately.

This is the strongest V1 comparison against raw persisted-snapshot deep diff.

### XState v6 alpha forward control

On XState 6.0.0-alpha.64:

- pending logical timers are present in the public persisted/snapshot `timers` map;
- DSI sees the timer before and after hydration;
- a custom `SimulatedClock` intentionally restores the full declared delay because its old epoch is not portable;
- the restored timer fires after that declared delay;
- the default wall-clock runtime persists `startedAt`.

The same DSI abstraction therefore distinguishes v5's lost obligation from v6's explicit persisted timer contract.

### XState v6 machine-version migration

On XState 6.0.0-alpha.64:

- a version-1 machine persists `machine.version = "1"` and top-level `version = "1"`;
- `machineVersions([v1, v2]).migrateSnapshot(...)` transforms `context.count` to the v2 `context.total` contract;
- migration stamps the target machine/version identity as `"2"`;
- the migrated/restored actor's DSI matches an independently constructed native v2 actor with the equivalent target context;
- after both actors consume the same v2 `ADD` event, their DSI remains equivalent;
- re-persistence retains v2 identity and context.

This tests migration against **target decision semantics**, not against source-snapshot equality.

### XState v6 stable address / registry control

On XState 6.0.0-alpha.64:

- root address `root` survives persistence;
- invoked child address `root/worker` survives persistence;
- `registryKey: "primary-worker"` survives and resolves after restore;
- child state/context survives;
- a routed `PING` remains operational;
- persist -> restore -> persist -> restore preserves the same DSI.

The DSI reuses its existing actor-identity category and records public v6 `address` / `registryKey` when available.

### Adjacent-alpha stability

The same unchanged DSI categories were then run on XState **6.0.0-alpha.63**:

- logical timer persistence/hydration: green;
- stable root/child address + registry identity: green.

No issue-specific or new semantic category was required between alpha.63 and alpha.64.

## Comparator result so far

| Failure | Visible state only | Raw persisted deep diff | DSI hydration | Re-persist / continuation |
| --- | --- | --- | --- | --- |
| #5178 history | miss | miss | miss | **hit** |
| #5077 child re-persist | n/a | operation fails | possible structural signal | **hit** |
| #4873 system child | miss until use | not sufficient | not sufficient alone | **hit** |
| #5331 delayed transition | miss | miss | **hit** | hit |

## Counterexample / comparator gate

A failing cut now emits a machine-readable `xstate-persistence-counterexample/v1` artifact containing:

- prefix, cut and suffix;
- failing stage and suffix step when applicable;
- persisted snapshot;
- control/restored DSI;
- exact semantic differences or runtime error;
- comparator verdicts.

For the retained v5 timer failure:

```text
visibleStateOnly:      pass
rawPersistedDeepDiff:  pass
dsiHydration:          fail
repersistenceClosure:  pass
continuationOnly:      fail
fullConformance:       fail
```

This turns the baseline comparison into executable evidence rather than interpretation after the fact.

## Decision

**The bounded V1 research pass is complete.**

The retained result is stronger than the initial synthetic demonstration:

- multiple independent public persistence failures are recovered without issue-specific checker rules;
- a historical failure is distinguished from current fixed behavior;
- weaker comparators are executable and demonstrably miss real failures;
- failures emit machine-readable counterexamples;
- v6's repaired timer surface stays green;
- v6 machine-version migration matches independently constructed target semantics;
- v6 stable actor addresses/registry remain operational through persistence;
- the same DSI categories remain green across adjacent alpha.63/alpha.64.

This is enough to call the target-specific proof-of-work coherent.

## Stop rule now in force

Do **not** add more hand-authored cases or DSI categories merely to enlarge the project.

Reopen implementation work only for:

1. a newly reported XState persistence/hydration failure that the current checker can test;
2. an upstream maintainer request;
3. a stable v6 release that materially changes the public persistence contract.

If those require issue-specific rules or private-field expansion, archive the mechanism rather than widening it indefinitely.
