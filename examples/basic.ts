import { createMachine } from "xstate";
import { checkPersistenceTrace, renderConformanceReport } from "../src/index.js";

const machine = createMachine({
  id: "checkout",
  initial: "cart",
  states: {
    cart: {
      on: { CHECKOUT: "payment" },
    },
    payment: {
      on: {
        SUCCESS: "complete",
        CANCEL: "cart",
      },
    },
    complete: {
      type: "final",
    },
  },
});

const result = checkPersistenceTrace({
  logic: machine,
  trace: [
    { kind: "event", event: { type: "CHECKOUT" } },
    { kind: "event", event: { type: "SUCCESS" } },
  ],
});

console.log(renderConformanceReport(result));
