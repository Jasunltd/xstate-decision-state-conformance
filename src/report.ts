import type { TraceConformanceResult } from "./conformance.js";

export function renderConformanceReport(result: TraceConformanceResult): string {
  if (result.passed) {
    return [
      "PERSISTENCE CONFORMANCE: PASS",
      "cuts checked: " + result.cuts.length,
      "all hydrated decision-state indexes and bounded continuations matched",
    ].join("\n");
  }

  const failing = result.cuts.find((cut) => !cut.passed);
  if (!failing || !failing.firstDivergence) {
    return "PERSISTENCE CONFORMANCE: FAIL";
  }

  const divergence = failing.firstDivergence;
  const lines = [
    "PERSISTENCE CONFORMANCE: FAIL",
    "cut point: " + failing.cut,
    "first divergence: " + divergence.stage +
      (divergence.suffixOffset !== undefined
        ? " at suffix step " + divergence.suffixOffset
        : ""),
  ];
  if (divergence.error) {
    lines.push("error: " + divergence.error);
  }
  if (divergence.differences.length > 0) {
    lines.push("differences:");
    for (const difference of divergence.differences.slice(0, 12)) {
      lines.push(
        "  " + difference.path +
        "\n    control: " + JSON.stringify(difference.expected) +
        "\n    restored: " + JSON.stringify(difference.actual),
      );
    }
  }
  return lines.join("\n");
}
