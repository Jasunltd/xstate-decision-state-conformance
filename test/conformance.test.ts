import assert from "node:assert/strict";
import test from "node:test";
import { assign, createActor, createMachine, sendTo } from "xstate";
import {
  checkPersistenceAtCut,
  checkPersistenceTrace,
  decisionStateIndex,
} from "../src/index.js";

test("all-cut persistence preserves basic state and context continuation", () => {
  const machine = createMachine({
    id: "counter",
    context: { count: 0 },
    initial: "idle",
    states: {
      idle: {
        on: {
          START: "active",
        },
      },
      active: {
        on: {
          INC: {
            actions: assign({
              count: ({ context }) => context.count + 1,
            }),
          },
          STOP: "done",
        },
      },
      done: {
        type: "final",
      },
    },
  });

  const result = checkPersistenceTrace({
    logic: machine,
    trace: [
      { kind: "event", event: { type: "START" } },
      { kind: "event", event: { type: "INC" } },
      { kind: "event", event: { type: "INC" } },
      { kind: "event", event: { type: "STOP" } },
    ],
  });

  assert.equal(result.passed, true);
  assert.equal(result.cuts.length, 5);
});

test("history decision state survives persistence and produces the same continuation", () => {
  const machine = createMachine({
    id: "history-check",
    initial: "editing",
    states: {
      editing: {
        initial: "one",
        states: {
          hist: {
            id: "editing-history",
            type: "history",
            history: "deep",
          },
          one: {
            on: { NEXT: "two" },
          },
          two: {},
        },
        on: { LEAVE: "review" },
      },
      review: {
        on: { BACK: "#editing-history" },
      },
    },
  });

  const result = checkPersistenceAtCut(
    {
      logic: machine,
      trace: [
        { kind: "event", event: { type: "NEXT" } },
        { kind: "event", event: { type: "LEAVE" } },
        { kind: "event", event: { type: "BACK" } },
      ],
    },
    2,
  );

  assert.equal(result.passed, true);
  assert.deepEqual(result.continuation.at(-1)?.control.value, {
    editing: "two",
  });
});

test("child actor topology and child continuation survive persistence", () => {
  const child = createMachine({
    id: "worker",
    initial: "idle",
    states: {
      idle: { on: { PING: "active" } },
      active: {},
    },
  });

  const parent = createMachine({
    id: "parent",
    initial: "running",
    states: {
      running: {
        invoke: {
          id: "worker",
          src: child,
        },
        on: {
          PING_CHILD: {
            actions: sendTo("worker", { type: "PING" }),
          },
        },
      },
    },
  });

  const result = checkPersistenceAtCut(
    {
      logic: parent,
      trace: [
        { kind: "event", event: { type: "PING_CHILD" } },
      ],
    },
    0,
  );

  assert.equal(result.passed, true);
  assert.equal(
    result.continuation[0]?.control.children.worker?.value,
    "active",
  );
  assert.equal(
    result.continuation[0]?.restored.children.worker?.value,
    "active",
  );
});

test("Decision State Index exposes lost scheduled obligations across hydration", () => {
  const machine = createMachine({
    id: "timer",
    initial: "idle",
    states: {
      idle: {
        on: { START: "waiting" },
      },
      waiting: {
        after: {
          1000: "done",
        },
      },
      done: {
        type: "final",
      },
    },
  });

  const result = checkPersistenceAtCut(
    {
      logic: machine,
      trace: [
        { kind: "event", event: { type: "START" } },
        { kind: "advance", ms: 1000 },
      ],
    },
    1,
  );

  assert.equal(result.hydration.control.value, "waiting");
  assert.equal(result.hydration.restored.value, "waiting");
  assert.equal(result.hydration.control.scheduled.length, 1);

  // XState 5.33.2 does not carry the root scheduler obligation through
  // actor.getPersistedSnapshot() -> JSON -> createActor({ snapshot }).
  // The state value looks identical, but the future decision differs.
  assert.equal(result.passed, false);
  assert.equal(result.hydration.restored.scheduled.length, 0);
  assert.ok(
    result.firstDivergence?.differences.some((difference) =>
      difference.path.includes("scheduled")
    ),
  );
});

test("decision-state projection is stable for an unchanged actor", () => {
  const machine = createMachine({
    id: "stable",
    initial: "a",
    states: { a: {} },
  });
  const actor = createActor(machine).start();
  try {
    assert.deepEqual(decisionStateIndex(actor), decisionStateIndex(actor));
  } finally {
    actor.stop();
  }
});
