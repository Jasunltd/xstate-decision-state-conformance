import assert from "node:assert/strict";
import test from "node:test";
import * as xstate6prev from "xstate-v6-prev";
import {
  compareDecisionStateIndexes,
  decisionStateIndex,
} from "../src/index.js";

function jsonRoundTrip(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

test("v6 alpha.63 stability: timer DSI category survives hydration unchanged", () => {
  const machine = xstate6prev.createMachine({
    id: "timer-prev",
    initial: "idle",
    states: {
      idle: { on: { START: { target: "waiting" } } },
      waiting: { after: { 1000: { target: "done" } } },
      done: { type: "final" },
    },
  } as any);

  const clock = new xstate6prev.SimulatedClock();
  const original = xstate6prev.createActor(machine, { clock }).start();
  original.send({ type: "START" });
  const before = decisionStateIndex(original);
  const persisted = jsonRoundTrip(original.getPersistedSnapshot());
  original.stop();

  const restoredClock = new xstate6prev.SimulatedClock();
  const restored = xstate6prev.createActor(machine, {
    clock: restoredClock,
    snapshot: persisted,
  }).start();

  try {
    const after = decisionStateIndex(restored);
    assert.equal(before.scheduled.length, 1);
    assert.equal(after.scheduled.length, 1);
    assert.equal(
      compareDecisionStateIndexes(before, after).equivalent,
      true,
    );
    restoredClock.increment(1000);
    assert.equal(restored.getSnapshot().value, "done");
  } finally {
    restored.stop();
  }
});

test("v6 alpha.63 stability: address and registry identity survive hydration", () => {
  const worker = xstate6prev.createMachine({
    id: "worker",
    initial: "idle",
    states: {
      idle: { on: { PING: { target: "active" } } },
      active: {},
    },
  } as any);

  const parent = xstate6prev.setup({
    actors: { worker },
  }).createMachine({
    id: "parent",
    initial: "running",
    states: {
      running: {
        invoke: {
          src: "worker",
          id: "worker",
          registryKey: "primary-worker",
        },
      },
    },
  } as any);

  const original = xstate6prev.createActor(parent, {
    id: "root",
    registryKey: "root",
  }).start();
  const before = decisionStateIndex(original);
  const persisted = jsonRoundTrip(original.getPersistedSnapshot());
  original.stop();

  const restored = xstate6prev.createActor(parent, {
    id: "root",
    registryKey: "root",
    snapshot: persisted,
  }).start();

  try {
    const after = decisionStateIndex(restored);
    const comparison = compareDecisionStateIndexes(before, after);
    assert.equal(
      comparison.equivalent,
      true,
      JSON.stringify(comparison.differences, null, 2),
    );
    assert.equal(restored.address, "root");
    assert.equal(
      restored.system.get("primary-worker")?.address,
      "root/worker",
    );
  } finally {
    restored.stop();
  }
});
