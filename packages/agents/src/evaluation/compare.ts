import { meanComposite, scoreRecordedRun, type AcsScore, type AcsSuiteV1 } from "./acs.js";
import type { AcsComparisonV1, AcsHarnessReportV1 } from "./types.js";

export const ACS_UPLIFT_TARGET = 10;

export function compareAcs(baseline: AcsScore, harnessed: AcsScore): AcsComparisonV1 {
  const uplift = round(harnessed.composite - baseline.composite);
  const relativeUplift = baseline.composite === 0 ? (harnessed.composite > 0 ? 100 : 0) : round((uplift / baseline.composite) * 100);
  return {
    suiteId: harnessed.suiteId,
    baseline: baseline.composite,
    harnessed: harnessed.composite,
    uplift,
    relativeUplift,
    meetsTarget: relativeUplift >= ACS_UPLIFT_TARGET,
  };
}

export function compareSuites(suites: readonly { suite: AcsSuiteV1; harnessed: AcsScore }[]): AcsHarnessReportV1 {
  const comparisons = suites.map(item => compareAcs(scoreRecordedRun(item.suite, item.suite.baseline), item.harnessed));
  const baselineMean = meanComposite(comparisons.map(item => ({ suiteId: item.suiteId, metrics: emptyMetrics(), composite: item.baseline })));
  const harnessMean = meanComposite(comparisons.map(item => ({ suiteId: item.suiteId, metrics: emptyMetrics(), composite: item.harnessed })));
  const relativeUplift = baselineMean === 0 ? (harnessMean > 0 ? 100 : 0) : round(((harnessMean - baselineMean) / baselineMean) * 100);
  return {
    version: 1,
    kind: "acs-harness-report",
    target: ACS_UPLIFT_TARGET,
    baselineMean,
    harnessMean,
    relativeUplift,
    meetsTarget: relativeUplift >= ACS_UPLIFT_TARGET,
    suites: comparisons,
  };
}

function emptyMetrics() {
  return { taskSuccess: 0, grounding: 0, toolCorrectness: 0, recovery: 0, policy: 0, efficiency: 0 };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
