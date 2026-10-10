# XState Decision-State Conformance

A small conformance checker for one question:

> **After an XState actor is persisted, JSON-round-tripped, and hydrated, does it still have the same decision-relevant state and bounded future behavior?**

This is a target-specific research artifact for XState/Stately. It is not an agent framework and does not attempt to compare raw snapshot bytes.

## Portfolio role

This is the current **XState / Stately lead artifact**. Seam is retained only as historical controller research. The project is held at a bounded, maintainer-oriented conformance surface rather than expanded into a general agent framework.

## Why Decision State Index

The project reuses an abstraction from a separate industrial research case: materialize the smallest state needed to preserve a decision across a boundary.

For XState, the boundary is persistence/hydration.

```text
live actor
   |
   v
Decision State Index
   |
persist -> JSON -> hydrate
   |
   v
Decision State Index

same decision state?
same bounded continuation?
```

V1 projects:

- active state value;
- context;
- status/output/error;
- history memory;
- child actor topology and child decision state;
- stable actor address / registry identity when exposed by the runtime;
- scheduled-event obligations.

It intentionally ignores arbitrary runtime object identity.

## API

```ts
import { checkPersistenceTrace } from "xstate-decision-state-conformance";

const result = checkPersistenceTrace({
  logic: machine,
  trace: [
    { kind: "event", event: { type: "START" } },
    { kind: "event", event: { type: "NEXT" } },
  ],
});
```

By default every cut point is tested. For each cut:

1. run the prefix;
2. build the live Decision State Index;
3. call `getPersistedSnapshot()`;
4. JSON stringify/parse;
5. hydrate a new actor;
6. compare Decision State Indexes;
7. prove the restored actor can be persisted/hydrated again;
8. replay the same suffix on control and restored actors;
9. report the first semantic divergence.

A failing run can also emit a machine-readable `xstate-persistence-counterexample/v1` artifact containing the cut point, prefix/suffix, persisted snapshot, control/restored DSI, precise differences, and comparator verdicts.

## First useful counterexample

On XState **5.33.2**, a machine can enter a state with an `after` transition, persist successfully, restore into the same visible state value, and nevertheless lose the scheduled transition obligation.

The checker reports this as a hydration divergence in `scheduled` even though both actors say they are in `"waiting"`.

That is the kind of persistence bug this project is designed to make small and actionable.

## Public-issue gate

The same generic checker surface now covers multiple independently reported XState persistence failures:

| Public issue | Observed result |
| --- | --- |
| #5178 history restore | reproduced on 5.19.2; green on 5.33.2 |
| #5077 child re-persistence | reproduced on 5.18.1 and 5.33.2 |
| #4873 restored system child | reproduced on 5.33.2 |
| #5331 delayed transition | reproduced on 5.33.2 |
| v6 timer forward control | green on 6.0.0-alpha.64 |

Two baseline failures are especially useful:

- historical #5178 has JSON-equal persisted snapshots before/after hydration and equal visible state at hydration, yet diverges on the next history transition;
- current #5331 has equal visible state and JSON-equal persisted snapshots, yet the restored actor has lost its delayed-transition obligation.

See [research/PUBLIC-ISSUE-MATRIX.md](research/PUBLIC-ISSUE-MATRIX.md) and [research/V1-SNAPSHOT.md](research/V1-SNAPSHOT.md).

## Generated conformance benchmark

The public-issue result is now backed by a frozen generated corpus rather than only hand-selected reproductions.

- **120 seeded machines** across linear, context, guarded, history, timer, and registered-child families;
- **486 persistence cuts per runtime / 1,944 cuts total**;
- four pinned runtimes: 5.19.2, 5.33.2, 6.0.0-alpha.63, 6.0.0-alpha.64;
- **120/120 semantic mutations detected** on alpha.64;
- **0/120 representation-only false positives** for DSI conformance;
- raw persisted deep diff flags the same 120 semantic mutations but also **120/120 harmless metadata-only changes**;
- automatic reduction shrinks the generated history failure from 5 steps to 3 and the v5 timer failure from 2 steps to 1.

Cross-version generated result:

| Runtime | Passing cases | Passing cuts |
| --- | ---: | ---: |
| XState 5.19.2 | 80 / 120 | 446 / 486 |
| XState 5.33.2 | 100 / 120 | 466 / 486 |
| XState 6.0.0-alpha.63 | **120 / 120** | **486 / 486** |
| XState 6.0.0-alpha.64 | **120 / 120** | **486 / 486** |

The failures are localized to the expected historical/current v5 history/timer families; the generated v6 corpus is green across all six families.

See [research/BENCHMARK-SNAPSHOT.md](research/BENCHMARK-SNAPSHOT.md) and [research/GENERATED-CORPUS.md](research/GENERATED-CORPUS.md).

## Commands

```bash
npm install
npm test
npm run example
npm run example:timer        # exits 2 and prints the counterexample
npm run example:timer:json   # exits 2 and emits machine-readable JSON
npm run benchmark            # regenerates the frozen 120-case benchmark receipts
```

## Package surface

The repository separates the distributable runtime package from research/test infrastructure.

- package entrypoint: `dist/index.js`;
- TypeScript declarations: `dist/index.d.ts`;
- CLI: `xstate-dsi-check`;
- XState is a peer dependency (`^5.33.2`);
- npm tarball includes only compiled runtime JS/types plus this README and `STATUS.md`;
- benchmark generators, historical runtime aliases, tests, examples, and research receipts stay repository-only.

`prepack` runs the complete test suite before producing the package build.

The package is licensed under the MIT License; see [LICENSE](LICENSE).

## Research boundary

This project does not claim:

- raw snapshot equality is desirable;
- every private runtime field is semantic;
- equivalent internal implementations must serialize identically;
- current XState behavior is necessarily a bug rather than an explicitly unsupported persistence boundary;
- this small matrix proves persistence correctness for arbitrary actor systems.

The bounded research pass is complete: public-issue reproduction, executable comparator evidence, machine-readable counterexamples, v6 timer/migration/address controls, adjacent-alpha stability, and the frozen generated benchmark all use the same DSI categories. Further work should be driven by a new independently reported persistence failure or an upstream maintainer need rather than by extending the ontology speculatively.

## License

MIT. See [LICENSE](LICENSE).
