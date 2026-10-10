import assert from "node:assert/strict";
import test from "node:test";
import {
  assign,
  createActor,
  createMachine,
} from "xstate";
import * as xstate5181 from "xstate-v5181";
import * as xstate5192 from "xstate-v5192";
import {
  checkPersistenceAtCut,
  decisionStateIndex,
} from "../src/index.js";

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("#5178 historical: serialized history restore diverges on XState 5.19.2", () => {
  const machine = xstate5192.createMachine({
    id: "history-public-repro",
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
          one: { on: { NEXT: "two" } },
          two: {},
        },
        on: { LEAVE: "review" },
      },
      review: {
        on: { BACK: "#editing-history" },
      },
    },
  });

  const control = xstate5192.createActor(machine).start();
  control.send({ type: "NEXT" });
  control.send({ type: "LEAVE" });

  const before = decisionStateIndex(control as never);
  const persisted = jsonRoundTrip(control.getPersistedSnapshot());
  const restored = xstate5192.createActor(machine, { snapshot: persisted as never }).start();
  try {
    const hydrated = decisionStateIndex(restored as never);
    const persistedAgain = jsonRoundTrip(restored.getPersistedSnapshot());

    // Both raw persisted-state equality and visible state equality miss the
    // defect. It appears only when the restored history is later consumed.
    assert.deepEqual(persistedAgain, persisted);
    assert.equal(control.getSnapshot().value, "review");
    assert.equal(restored.getSnapshot().value, "review");
    assert.deepEqual(hydrated.history, before.history);

    control.send({ type: "BACK" });
    restored.send({ type: "BACK" });

    assert.deepEqual(control.getSnapshot().value, { editing: "two" });
    assert.deepEqual(
      restored.getSnapshot().value,
      { editing: "one" },
      "serialized restore loses executable history semantics",
    );
  } finally {
    control.stop();
    restored.stop();
  }
});

test("#5178 current: history restore is fixed on XState 5.33.2", () => {
  const machine = createMachine({
    id: "history-current",
    initial: "editing",
    states: {
      editing: {
        initial: "one",
        states: {
          hist: {
            id: "editing-history-current",
            type: "history",
            history: "deep",
          },
          one: { on: { NEXT: "two" } },
          two: {},
        },
        on: { LEAVE: "review" },
      },
      review: {
        on: { BACK: "#editing-history-current" },
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
  assert.deepEqual(result.continuation.at(-1)?.restored.value, {
    editing: "two",
  });
});

function inlineSpawnParent() {
  const ChildMachine = {
    id: "child",
    initial: "running",
    context: { count: 0 },
    states: {
      running: {
        on: {
          tick: {
            actions: assign({
              count: ({ context }) => context.count + 1,
            }),
          },
        },
      },
    },
  };

  return createMachine({
    id: "parent",
    initial: "idle",
    states: {
      idle: {
        on: {
          start: {
            target: "running",
            actions: assign(({ spawn, event }) => {
              const childId = (event as unknown as { childId: string }).childId;
              spawn((createMachine as any)(ChildMachine), {
                id: childId,
                systemId: childId,
              });
              return {};
            }),
          },
        },
      },
      running: {
        on: {
          tick: {
            actions: ({ system, event }) => {
              system.get((event as unknown as { id: string }).id)?.send({ type: "tick" });
            },
          },
        },
      },
    },
  });
}

test("#5077 current: restored inline-spawned children cannot be persisted again", () => {
  const machine = inlineSpawnParent();

  const result = checkPersistenceAtCut(
    {
      logic: machine,
      trace: [
        { kind: "event", event: { type: "start", childId: "worker-1" } },
      ],
    },
    1,
  );

  assert.equal(result.passed, false);
  assert.equal(result.firstDivergence?.stage, "repersist");
  assert.equal(result.repersistence.ok, false);
  assert.match(
    result.repersistence.error ?? "",
    /getPersistedSnapshot is not a function/,
  );
});

test("#5077 reported line: XState 5.18.1 reproduces re-persistence failure", () => {
  const { assign: assign5181, createActor: actor5181, createMachine: machine5181 } = xstate5181;
  const childConfig = {
    id: "child-5181",
    initial: "running",
    states: { running: {} },
  };
  const parent = machine5181({
    id: "parent-5181",
    initial: "idle",
    states: {
      idle: {
        on: {
          start: {
            target: "running",
            actions: assign5181(({ spawn, event }) => {
              spawn(machine5181(childConfig), {
                id: (event as unknown as { childId: string }).childId,
              });
              return {};
            }),
          },
        },
      },
      running: {},
    },
  });

  const original = actor5181(parent).start();
  original.send({ type: "start", childId: "worker" });
  const persisted = jsonRoundTrip(original.getPersistedSnapshot());
  original.stop();

  const restored = actor5181(parent, { snapshot: persisted as never }).start();
  try {
    assert.throws(
      () => restored.getPersistedSnapshot(),
      /getPersistedSnapshot is not a function/,
    );
  } finally {
    restored.stop();
  }
});

test("#4873 current: serialized inline child registry entry becomes unusable on routed event", () => {
  const machine = inlineSpawnParent();
  const original = createActor(machine, {
    id: "parent",
    systemId: "parent",
  }).start();
  original.send({ type: "start", childId: "worker-1" });
  const persisted = jsonRoundTrip(original.getPersistedSnapshot());
  original.stop();

  const restored = createActor(machine, {
    id: "parent",
    systemId: "parent",
    snapshot: persisted as never,
  });
  restored.subscribe({ error: () => {} });
  restored.start();

  try {
    assert.ok(restored.system.get("worker-1"));
    restored.send({ type: "tick", id: "worker-1" });
    assert.equal(restored.getSnapshot().status, "error");
    assert.match(
      String(restored.getSnapshot().error),
      /logic\.transition is not a function/,
    );
  } finally {
    restored.stop();
  }
});

test("#5331 baseline: persisted snapshot deep equality misses lost delayed-transition obligation", () => {
  const machine = createMachine({
    id: "timer-public-repro",
    initial: "idle",
    states: {
      idle: { on: { START: "waiting" } },
      waiting: { after: { 1000: "done" } },
      done: { type: "final" },
    },
  });

  const original = createActor(machine).start();
  original.send({ type: "START" });
  const liveIndex = decisionStateIndex(original);
  const persisted = jsonRoundTrip(original.getPersistedSnapshot());

  const restored = createActor(machine, { snapshot: persisted as never }).start();
  try {
    const persistedAgain = jsonRoundTrip(restored.getPersistedSnapshot());
    const restoredIndex = decisionStateIndex(restored);

    assert.deepEqual(
      persistedAgain,
      persisted,
      "raw persisted-snapshot deep diff sees no problem",
    );
    assert.equal(liveIndex.value, restoredIndex.value);
    assert.equal(liveIndex.scheduled.length, 1);
    assert.equal(restoredIndex.scheduled.length, 0);
  } finally {
    original.stop();
    restored.stop();
  }
});
