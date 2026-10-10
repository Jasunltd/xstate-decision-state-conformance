import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_SCHEMA,
  generateCorpus,
  runBenchmark,
} from "../src/benchmark.js";

test("generated corpus is deterministic for a fixed seed", () => {
  assert.deepEqual(
    generateCorpus(18, 12345),
    generateCorpus(18, 12345),
  );
  assert.notDeepEqual(
    generateCorpus(18, 12345),
    generateCorpus(18, 12346),
  );
});

test("small benchmark exercises every family across all pinned runtimes", () => {
  const result = runBenchmark(12, 98765);
  assert.equal(result.schema, BENCHMARK_SCHEMA);
  assert.equal(result.corpusSize, 12);
  assert.equal(result.runtimeMatrix.length, 4);
  assert.equal(result.mutations.semanticTotal, 12);
  assert.equal(result.mutations.semanticKilled, 12);
  assert.equal(result.mutations.noopTotal, 12);
  assert.equal(result.mutations.noopFalsePositives, 0);
  assert.equal(result.mutations.rawSemanticDetected, 12);
  assert.equal(result.mutations.rawNoopFalsePositives, 12);

  const v5192 = result.runtimeMatrix.find(
    (row: { runtime: string }) => row.runtime === "xstate-5.19.2",
  );
  const v5332 = result.runtimeMatrix.find(
    (row: { runtime: string }) => row.runtime === "xstate-5.33.2",
  );
  const v6Rows = result.runtimeMatrix.filter(
    (row: { runtime: string }) => row.runtime.startsWith("xstate-6."),
  );

  assert.equal(v5192?.passingCases, 8);
  assert.equal(v5332?.passingCases, 10);
  assert.ok(v6Rows.every((row: { passingCases: number }) => row.passingCases === 12));

  const families = new Set(
    result.corpus.map((item: { family: string }) => item.family),
  );
  assert.deepEqual(
    [...families].sort(),
    ["child", "context", "guarded", "history", "linear", "timer"],
  );
});
