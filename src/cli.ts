#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { PersistenceScenario } from "./conformance.js";
import { checkPersistenceTrace } from "./conformance.js";
import { firstCounterexample } from "./counterexample.js";
import { renderConformanceReport } from "./report.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const modulePath = args.find((arg) => !arg.startsWith("--"));

if (!modulePath) {
  process.stderr.write(
    "usage: xstate-dsi-check <scenario-module> [--json]\n" +
    "scenario module must export `scenario` or a default PersistenceScenario\n",
  );
  process.exit(64);
}

const loaded = await import(pathToFileURL(resolve(modulePath)).href) as {
  scenario?: PersistenceScenario;
  default?: PersistenceScenario;
};
const scenario = loaded.scenario ?? loaded.default;
if (!scenario || !scenario.logic || !Array.isArray(scenario.trace)) {
  throw new TypeError("scenario module must export { logic, trace, ... }");
}

const result = checkPersistenceTrace(scenario);

if (json) {
  if (result.passed) {
    process.stdout.write(
      JSON.stringify(
        {
          schema: "xstate-persistence-conformance-result/v1",
          passed: true,
          cutsChecked: result.cuts.length,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(JSON.stringify(firstCounterexample(result), null, 2) + "\n");
  }
} else {
  process.stdout.write(renderConformanceReport(result) + "\n");
}

if (!result.passed) process.exitCode = 2;
