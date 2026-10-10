# Attribution, upstream references and software licensing

## Original implementation

The project's conformance checker, Decision State Index, test harness,
independently authored minimal reproductions, fixtures and authored
documentation are staged under [MIT](LICENSE), subject to copyright and
contributor rights review. See [license scope](LICENSE-SCOPE.md).

## Upstream XState / Stately project

- **Source and publisher:** [Stately / XState](https://github.com/statelyai/xstate),
  originally developed by David Khourshid and its contributors.
- **Official API documentation:** [Stately XState documentation](https://stately.ai/docs).
- **Upstream license:** [MIT](https://github.com/statelyai/xstate/blob/main/LICENSE).
- **Runtime usage:** `xstate` is a required **peer dependency** for the
  published API, not an implementation copied into this repository.
- **Frozen test/runtime controls:** XState 5.18.1, 5.19.2, 5.33.2,
  and 6.0.0-alpha.63/alpha.64. See `package.json`, `package-lock.json`,
  `research/BENCHMARK-SNAPSHOT.md` and the generator fixtures for exact
  comparisons.

### Publicly reported issue cases

The following upstream XState reports motivate reproducible boundary tests;
issue reports are external evidence, not intellectual property transferred to
this project:

| Issue | Public source | Research role |
| --- | --- | --- |
| #5178 — history restoration | https://github.com/statelyai/xstate/issues/5178 | historical replay/continuation case |
| #5077 — child re-persistence | https://github.com/statelyai/xstate/issues/5077 | persist → hydrate → persist closure |
| #4873 — restored system child | https://github.com/statelyai/xstate/issues/4873 | operational routed-continuation case |
| #5331 — delayed transition | https://github.com/statelyai/xstate/issues/5331 | deferred-timer persistence case |

Exact case-to-runtime observations:
[research/PUBLIC-ISSUE-MATRIX.md](research/PUBLIC-ISSUE-MATRIX.md)
and [machine-readable issue matrix](research/public-issue-matrix.json).
These outcomes describe pinned reproduced behavior; they do **not** claim
an upstream defect status, certification, or current support commitment.

## Distribution and non-affiliation

XState itself is obtained separately by npm and governed by its upstream MIT
terms and authorship. Development toolchains, historical npm aliases, and
other packages are separate dependencies, not vendored source releases.
`package-lock.json` records the pinned development versions.

This repository is an independent research implementation; it is not
Stately's or XState's official conformance suite. Names identify
interoperability and issue sources only. Candidate publication and copyright
ownership review are still pending.
