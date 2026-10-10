# Project Status

**Status:** bounded V1 complete; hold for independent new evidence

## Portfolio role

**Lead artifact for XState / Stately technical presentation.** This supersedes Seam as the current XState-facing project. The presentation claim is semantic and narrow: persistence/hydration should preserve decision-relevant future behavior, not merely visible state or serialized shape.

## Result

XState Decision-State Conformance is a target-specific persistence/hydration checker built around a Decision State Index rather than raw snapshot equality.

Current retained validation:

- **22/22 tests passing**;
- stable XState 5.33.2 plus historical 5.18.1 / 5.19.2 controls;
- v6 forward controls on 6.0.0-alpha.63 / alpha.64;
- public issue reproductions for history restoration, child re-persistence, restored system-child usability, and delayed transitions;
- machine-readable counterexample output;
- executable visible-state, raw-persisted, DSI, re-persistence, and continuation comparators;
- v6 logical timer persistence;
- v6 machine-version migration conformance against native target semantics;
- v6 stable actor address / registry identity, routed continuation, and re-persistence;
- **120-machine seeded generated corpus / 1,944 persistence cuts** across four runtimes;
- **120/120 semantic mutations detected, 0/120 representation-only DSI false positives**;
- raw persisted deep diff: 120/120 semantic mutations detected but **120/120 representation-only false positives**;
- automatic trace reduction for generated history and timer failures.

## Retained claim

> Persistence conformance is a decision-semantics property, not a serialization-shape property.

A restored actor can preserve visible state and even produce a JSON-equal persisted snapshot while losing information that changes future behavior. A small DSI plus re-persistence and bounded continuation catches retained examples that weaker checks miss.

The generated corpus adds a specificity result: raw persisted deep diff detects the semantic corruptions but also flags every harmless metadata-only mutation, while DSI conformance detects all 120 semantic mutations and ignores all 120 representation-only changes in the frozen benchmark.

## Boundaries

This project does not claim complete XState persistence verification, field coverage for arbitrary actor systems, or that every reproduced current behavior is necessarily an upstream defect rather than an unsupported boundary.

The DSI deliberately stays small:

- state value;
- context;
- status/output/error;
- history memory;
- child topology/state;
- stable actor identity when public;
- delayed/timer obligations.

## Reopen rule

Do not expand the ontology speculatively.

Reopen only when:

1. a new independent XState persistence/hydration report provides a falsifiable case;
2. an XState/Stately maintainer asks for a concrete extension;
3. stable XState v6 materially changes the persistence contract.

If a new case can only be solved with issue-specific rules or private-runtime coupling, prefer archiving the mechanism.
