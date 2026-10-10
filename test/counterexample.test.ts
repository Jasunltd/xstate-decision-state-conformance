import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createMachine } from "xstate";
import {
  checkPersistenceTrace,
  firstCounterexample,
} from "../src/index.js";

test("counterexample artifact explains which weaker checks miss a timer failure", () => {
  const machine = createMachine({
    id: "timer-artifact",
    initial: "idle",
    states: {
      idle: { on: { START: "waiting" } },
      waiting: { after: { 1000: "done" } },
      done: { type: "final" },
    },
  });

  const result = checkPersistenceTrace({
    logic: machine,
    trace: [
      { kind: "event", event: { type: "START" } },
      { kind: "advance", ms: 1000 },
    ],
    cutPoints: [1],
  });
  const artifact = firstCounterexample(result);

  assert.ok(artifact);
  assert.equal(artifact.schema, "xstate-persistence-counterexample/v1");
  assert.equal(artifact.cut, 1);
  assert.equal(artifact.stage, "hydrate");
  assert.equal(artifact.comparators.visibleStateOnly, "pass");
  assert.equal(artifact.comparators.rawPersistedDeepDiff, "pass");
  assert.equal(artifact.comparators.dsiHydration, "fail");
  assert.equal(artifact.comparators.fullConformance, "fail");
  assert.ok(
    artifact.differences.some((difference) =>
      difference.path.includes("scheduled")
    ),
  );
  assert.doesNotThrow(() => JSON.stringify(artifact));
});

test("passing trace has no counterexample artifact", () => {
  const machine = createMachine({
    id: "green",
    initial: "a",
    states: {
      a: { on: { NEXT: "b" } },
      b: {},
    },
  });
  const result = checkPersistenceTrace({
    logic: machine,
    trace: [{ kind: "event", event: { type: "NEXT" } }],
  });
  assert.equal(result.passed, true);
  assert.equal(firstCounterexample(result), undefined);
});

test("CLI --json emits a machine-readable counterexample", () => {
  const child = spawnSync(
    process.execPath,
    [
      "dist-test/src/cli.js",
      "dist-test/examples/timer-scenario.js",
      "--json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(child.status, 2);
  const artifact = JSON.parse(child.stdout) as {
    schema?: string;
    stage?: string;
    comparators?: { rawPersistedDeepDiff?: string };
  };
  assert.equal(artifact.schema, "xstate-persistence-counterexample/v1");
  assert.equal(artifact.stage, "hydrate");
  assert.equal(artifact.comparators?.rawPersistedDeepDiff, "pass");
});
