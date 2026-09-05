import type { AcsComparisonV1, AcsHarnessReportV1 } from "./types.js";

/** Deterministic markdown report from an ACS comparison receipt. */
export function formatAcsReport(report: AcsHarnessReportV1): string {
  const lines = [
    "# ACS harness report",
    "",
    `- Target relative uplift: ${report.target}%`,
    `- Baseline mean: ${formatNumber(report.baselineMean)}`,
    `- Harness mean: ${formatNumber(report.harnessMean)}`,
    `- Relative uplift: ${formatNumber(report.relativeUplift)}%`,
    `- Meets target: ${report.meetsTarget ? "yes" : "no"}`,
    "",
    "| Suite | Baseline | Harnessed | Relative uplift | Meets target |",
    "| --- | ---: | ---: | ---: | --- |",
    ...report.suites.map(row),
    "",
  ];
  return lines.join("\n");
}

function row(item: AcsComparisonV1): string {
  return `| ${item.suiteId} | ${formatNumber(item.baseline)} | ${formatNumber(item.harnessed)} | ${formatNumber(item.relativeUplift)}% | ${item.meetsTarget ? "yes" : "no"} |`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
