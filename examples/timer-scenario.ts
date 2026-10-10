import { createMachine } from "xstate";
import type { PersistenceScenario } from "../src/index.js";

const machine = createMachine({
  id: "timer-demo",
  initial: "idle",
  states: {
    idle: { on: { START: "waiting" } },
    waiting: { after: { 1000: "done" } },
    done: { type: "final" },
  },
});

export const scenario: PersistenceScenario = {
  logic: machine,
  trace: [
    { kind: "event", event: { type: "START" } },
    { kind: "advance", ms: 1000 },
  ],
  cutPoints: [1],
};
