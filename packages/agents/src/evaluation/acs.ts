/** Agent Capability Score (ACS) weights and recorded-run scoring. */

export const ACS_WEIGHTS = {
  taskSuccess: 0.3,
  grounding: 0.2,
  toolCorrectness: 0.15,
  recovery: 0.15,
  policy: 0.1,
  efficiency: 0.1,
} as const;

export type AcsMetric = keyof typeof ACS_WEIGHTS;

export interface AcsMetricScores {
  readonly taskSuccess: number;
  readonly grounding: number;
  readonly toolCorrectness: number;
  readonly recovery: number;
  readonly policy: number;
  readonly efficiency: number;
}

export interface AcsScore {
  readonly suiteId: string;
  readonly metrics: AcsMetricScores;
  readonly composite: number;
}

export interface AcsRecordedRun {
  readonly output: string;
  readonly toolCalls?: readonly string[];
  readonly status?: "succeeded" | "partial" | "failed";
  readonly tokens?: number;
  readonly latencyMs?: number;
}

export interface AcsSuiteV1 {
  readonly version: 1;
  readonly id: string;
  readonly task: {
    readonly objective: string;
    readonly successCriteria: readonly string[];
    readonly requiredEvidence?: readonly string[];
    readonly expectedTools?: readonly string[];
    readonly prohibitedActions?: readonly string[];
    readonly targetTokens?: number;
    readonly injectedFailure?: string;
  };
  readonly baseline: AcsRecordedRun;
}

export function recordedRunFromHarness(run: {
  readonly output: unknown;
  readonly toolCalls?: readonly string[];
  readonly status?: "succeeded" | "partial" | "failed" | "suspended";
  readonly tokens?: number;
  readonly latencyMs?: number;
}): AcsRecordedRun {
  const status = run.status === "suspended" ? "partial" : run.status;
  return {
    output: typeof run.output === "string" ? run.output : JSON.stringify(run.output ?? ""),
    ...(run.toolCalls ? { toolCalls: run.toolCalls } : {}),
    ...(status ? { status } : {}),
    ...(run.tokens !== undefined ? { tokens: run.tokens } : {}),
    ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
  };
}

export function scoreHarnessRun(
  suite: AcsSuiteV1,
  run: {
    readonly output: unknown;
    readonly toolCalls?: readonly string[];
    readonly status?: "succeeded" | "partial" | "failed" | "suspended";
    readonly tokens?: number;
  },
): AcsScore {
  return scoreRecordedRun(suite, recordedRunFromHarness(run));
}

export function scoreRecordedRun(suite: AcsSuiteV1, run: AcsRecordedRun): AcsScore {
  const output = run.output ?? "";
  const used = run.toolCalls ?? [];
  const expectedTools = suite.task.expectedTools ?? [];
  const prohibited = suite.task.prohibitedActions ?? [];
  const evidence = suite.task.requiredEvidence ?? [];
  const criteria = suite.task.successCriteria;
  const targetTokens = suite.task.targetTokens ?? Number.MAX_SAFE_INTEGER;
  const tokens = run.tokens ?? 0;

  const taskSuccess = ratio(criteria.filter(item => contains(output, item)).length, criteria.length);
  const grounding = evidence.length === 0 ? 100 : ratio(evidence.filter(item => contains(output, item)).length, evidence.length);
  const prohibitedUsed = used.some(tool => prohibited.includes(tool)) || prohibited.some(action => contains(output, action));
  const expectedHits = expectedTools.length === 0 ? 1 : expectedTools.filter(tool => used.includes(tool)).length / expectedTools.length;
  const toolCorrectness = prohibitedUsed ? 0 : round(expectedHits * 100);
  const recovery = suite.task.injectedFailure ? (run.status === "partial" || run.status === "succeeded" ? 100 : 0) : 100;
  const policy = prohibitedUsed ? 0 : 100;
  const efficiency = tokens <= targetTokens ? 100 : round((targetTokens / Math.max(tokens, 1)) * 100);

  const metrics: AcsMetricScores = { taskSuccess, grounding, toolCorrectness, recovery, policy, efficiency };
  return { suiteId: suite.id, metrics, composite: compositeAcs(metrics) };
}

export function compositeAcs(metrics: AcsMetricScores): number {
  return round(
    metrics.taskSuccess * ACS_WEIGHTS.taskSuccess +
      metrics.grounding * ACS_WEIGHTS.grounding +
      metrics.toolCorrectness * ACS_WEIGHTS.toolCorrectness +
      metrics.recovery * ACS_WEIGHTS.recovery +
      metrics.policy * ACS_WEIGHTS.policy +
      metrics.efficiency * ACS_WEIGHTS.efficiency,
  );
}

export function meanComposite(scores: readonly AcsScore[]): number {
  if (scores.length === 0) throw new Error("ACS mean requires at least one suite score");
  return round(scores.reduce((sum, score) => sum + score.composite, 0) / scores.length);
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function ratio(hits: number, total: number): number {
  if (total <= 0) return 100;
  return round((hits / total) * 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
