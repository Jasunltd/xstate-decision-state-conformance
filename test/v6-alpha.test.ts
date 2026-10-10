import assert from "node:assert/strict";
import test from "node:test";
import * as xstate6 from "xstate-v6";
import { decisionStateIndex } from "../src/index.js";

function timerMachine() {
  return xstate6.createMachine({
    id: "timer-v6",
    initial: "idle",
    states: {
      idle: { on: { START: { target: "waiting" } } },
      waiting: { after: { 1000: { target: "done" } } },
      done: { type: "final" },
    },
  });
}

test("v6 alpha: persisted logical timer survives hydration and fires under simulated clock", () => {
  const machine = timerMachine();
  const controlClock = new xstate6.SimulatedClock();
  const control = xstate6.createActor(machine, { clock: controlClock }).start();
  control.send({ type: "START" });
  controlClock.increment(400);

  const before = decisionStateIndex(control as never);
  const persisted = JSON.parse(JSON.stringify(control.getPersistedSnapshot()));
  control.stop();

  assert.equal(Object.keys(persisted.timers ?? {}).length, 1);
  const persistedTimer = Object.values(persisted.timers ?? {})[0] as
    | Record<string, unknown>
    | undefined;
  assert.equal(persistedTimer?.delay, 1000);
  assert.equal(
    persistedTimer?.startedAt,
    undefined,
    "custom clocks intentionally do not persist a wall-clock startedAt",
  );

  const restoredClock = new xstate6.SimulatedClock();
  restoredClock.set(400);
  const restored = xstate6.createActor(machine, {
    clock: restoredClock,
    snapshot: persisted,
  }).start();

  try {
    const after = decisionStateIndex(restored as never);
    assert.equal(before.scheduled.length, 1);
    assert.equal(after.scheduled.length, 1);
    assert.equal(after.value, "waiting");

    // Under a custom clock, alpha.64 intentionally restarts the full declared
    // delay because the old clock's epoch is not portable across processes.
    restoredClock.increment(999);
    assert.equal(restored.getSnapshot().value, "waiting");
    restoredClock.increment(1);
    assert.equal(restored.getSnapshot().value, "done");
  } finally {
    restored.stop();
  }
});

test("v6 alpha: default wall-clock persistence stamps timer start", () => {
  const machine = timerMachine();
  const actor = xstate6.createActor(machine).start();
  actor.send({ type: "START" });

  try {
    const persisted = actor.getPersistedSnapshot() as {
      timers?: Record<string, { startedAt?: number; delay?: number }>;
    };
    const timer = Object.values(persisted.timers ?? {})[0];
    assert.equal(typeof timer?.startedAt, "number");
    assert.equal(timer?.delay, 1000);
  } finally {
    actor.stop();
  }
});
