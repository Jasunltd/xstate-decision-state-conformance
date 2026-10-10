import assert from "node:assert/strict";
import test from "node:test";
import * as xstate6 from "xstate-v6";
import {
  compareDecisionStateIndexes,
  decisionStateIndex,
} from "../src/index.js";

function jsonRoundTrip(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

test("v6 alpha: machineVersions migration restores the same decision state as native target construction", async () => {
  const v1 = xstate6.createMachine({
    id: "checkout",
    version: "1",
    context: { count: 2 },
    initial: "active",
    states: {
      active: {},
    },
  } as any);

  const v2 = xstate6.createMachine({
    id: "checkout",
    version: "2",
    context: ({ input }: any) => ({
      total: input?.total ?? 0,
    }),
    initial: "active",
    states: {
      active: {
        on: {
          ADD: {
            context: ({ context }: any) => ({
              total: context.total + 1,
            }),
          },
        },
      },
    },
  } as any);

  const source = xstate6.createActor(v1).start();
  const persistedV1 = jsonRoundTrip(source.getPersistedSnapshot());
  source.stop();

  assert.equal(persistedV1.machine?.version, "1");
  assert.equal(persistedV1.version, "1");

  const versions = xstate6.machineVersions([v1, v2] as any);
  const migrated = await versions.migrateSnapshot(persistedV1, {
    to: "2",
    migrations: {
      "1": async (snapshot: any) => ({
        ...snapshot,
        context: { total: snapshot.context.count },
      }),
    },
  } as any);

  assert.equal(migrated.machine?.id, "checkout");
  assert.equal(migrated.machine?.version, "2");
  assert.equal(migrated.version, "2");

  const restored = xstate6.createActor(v2, {
    snapshot: migrated as any,
  }).start();
  const nativeTarget = xstate6.createActor(v2, {
    input: { total: 2 },
  }).start();

  try {
    const initialComparison = compareDecisionStateIndexes(
      decisionStateIndex(nativeTarget),
      decisionStateIndex(restored),
    );
    assert.equal(
      initialComparison.equivalent,
      true,
      JSON.stringify(initialComparison.differences, null, 2),
    );

    nativeTarget.send({ type: "ADD" });
    restored.send({ type: "ADD" });

    const continuationComparison = compareDecisionStateIndexes(
      decisionStateIndex(nativeTarget),
      decisionStateIndex(restored),
    );
    assert.equal(
      continuationComparison.equivalent,
      true,
      JSON.stringify(continuationComparison.differences, null, 2),
    );
    assert.deepEqual(restored.getSnapshot().context, { total: 3 });

    const persistedAgain = jsonRoundTrip(restored.getPersistedSnapshot());
    assert.equal(persistedAgain.machine?.version, "2");
    assert.equal(persistedAgain.version, "2");
    assert.deepEqual(persistedAgain.context, { total: 3 });
  } finally {
    nativeTarget.stop();
    restored.stop();
  }
});

test("v6 alpha: child address, registry key, state, and routed continuation survive persistence", () => {
  const worker = xstate6.createMachine({
    id: "worker",
    context: { count: 0 },
    initial: "idle",
    states: {
      idle: {
        on: {
          PING: {
            target: "active",
            context: ({ context }: any) => ({
              count: context.count + 1,
            }),
          },
        },
      },
      active: {
        on: {
          PING: {
            context: ({ context }: any) => ({
              count: context.count + 1,
            }),
          },
        },
      },
    },
  } as any);

  const parent = xstate6.setup({
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

  const original = xstate6.createActor(parent, {
    id: "root",
    registryKey: "root",
  }).start();
  const workerBefore = original.system.get("primary-worker");
  assert.ok(workerBefore);
  workerBefore.send({ type: "PING" });

  const before = decisionStateIndex(original);
  assert.equal(before.actor.address, "root");
  assert.equal(before.actor.registryKey, "root");
  assert.equal(before.children.worker?.actor.address, "root/worker");
  assert.equal(
    before.children.worker?.actor.registryKey,
    "primary-worker",
  );

  const persisted = jsonRoundTrip(original.getPersistedSnapshot());
  original.stop();

  assert.equal(persisted.children.worker.address, "root/worker");
  assert.equal(persisted.children.worker.registryKey, "primary-worker");

  const restored = xstate6.createActor(parent, {
    id: "root",
    registryKey: "root",
    snapshot: persisted,
  }).start();

  try {
    const after = decisionStateIndex(restored);
    const hydrationComparison = compareDecisionStateIndexes(before, after);
    assert.equal(
      hydrationComparison.equivalent,
      true,
      JSON.stringify(hydrationComparison.differences, null, 2),
    );

    const workerAfter = restored.system.get("primary-worker");
    assert.ok(workerAfter);
    assert.equal(workerAfter.address, "root/worker");
    assert.deepEqual(workerAfter.getSnapshot().context, { count: 1 });

    workerAfter.send({ type: "PING" });
    assert.deepEqual(workerAfter.getSnapshot().context, { count: 2 });

    const persistedAgain = jsonRoundTrip(restored.getPersistedSnapshot());
    const restoredAgain = xstate6.createActor(parent, {
      id: "root",
      registryKey: "root",
      snapshot: persistedAgain,
    }).start();
    try {
      const secondComparison = compareDecisionStateIndexes(
        decisionStateIndex(restored),
        decisionStateIndex(restoredAgain),
      );
      assert.equal(
        secondComparison.equivalent,
        true,
        JSON.stringify(secondComparison.differences, null, 2),
      );
      assert.equal(
        restoredAgain.system.get("primary-worker")?.address,
        "root/worker",
      );
    } finally {
      restoredAgain.stop();
    }
  } finally {
    restored.stop();
  }
});
