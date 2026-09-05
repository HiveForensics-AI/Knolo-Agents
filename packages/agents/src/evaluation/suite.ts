import type { ContextEnvelopeV1, EvaluationReceiptV1, InvocationStatusV1, TaskV1 } from "../harness/types.js";
import { stringifyOutput } from "../harness/task.js";
import type { AgentInvocationResultV1 } from "../harness/types.js";
import { evaluateInvocation } from "../harness/lifecycle.js";
import type { HarnessDependencyRootV1 } from "../dependencies/types.js";
import type { AcsSuiteV1 } from "./acs.js";
import type { EvaluationCheckV1, SemanticJudgeRecordV1 } from "../harness/types.js";
import type { EvaluationSuiteV1, SemanticJudgeFn } from "./types.js";

const STATUSES: readonly InvocationStatusV1[] = ["succeeded", "partial", "failed", "suspended"];

export interface EvaluateRunInput {
  readonly task: TaskV1;
  readonly result: AgentInvocationResultV1;
  readonly toolCalls: readonly string[];
  readonly envelope: ContextEnvelopeV1;
  readonly dependencies: HarnessDependencyRootV1;
  readonly evidenceReceipts: readonly string[];
  readonly suite?: EvaluationSuiteV1 | AcsSuiteV1;
  readonly judge?: SemanticJudgeFn;
}

export function isAcsSuite(value: unknown): value is AcsSuiteV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as AcsSuiteV1;
  return record.version === 1 && typeof record.id === "string" && Boolean(record.task?.objective) && Array.isArray(record.task?.successCriteria) && Boolean(record.baseline);
}

export function parseEvaluationSuite(value: unknown): EvaluationSuiteV1 | AcsSuiteV1 | undefined {
  if (value === undefined || value === null) return undefined;
  if (isAcsSuite(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as EvaluationSuiteV1;
  if (record.version === 1 && typeof record.id === "string") return record;
  return undefined;
}

export async function evaluateRun(input: EvaluateRunInput): Promise<EvaluationReceiptV1> {
  const taskEval = evaluateInvocation(input.task, input.result.status, input.result.output, input.toolCalls);
  const output = stringifyOutput(input.result.output);
  const suiteTask = isAcsSuite(input.suite) ? input.suite.task : undefined;
  const expectedTools = suiteTask?.expectedTools ?? (input.suite && "expectedTools" in input.suite ? input.suite.expectedTools : undefined) ?? [];
  const requiredEvidence = [
    ...(input.task.evidenceRequirements ?? []),
    ...(suiteTask?.requiredEvidence ?? []),
    ...((input.suite && "requiredEvidence" in input.suite ? input.suite.requiredEvidence : undefined) ?? []),
  ];
  const envelopeText = JSON.stringify(input.envelope.evidence);
  const checks: EvaluationCheckV1[] = [
    check("contract", "policy", taskEval.prohibitedViolations.length === 0, taskEval.prohibitedViolations.join(",") || "ok"),
    check("contract", "terminal", STATUSES.includes(input.result.status), input.result.status),
    check("contract", "budget", withinBudget(input.result.tokens, input.task.budget?.maxTokens ?? suiteTask?.targetTokens), String(input.result.tokens ?? 0)),
    check("contract", "schema", matchesSchema(input.result.output, input.task.outputSchema), "output"),
    check("artifact", "dependencyRoot", Boolean(input.dependencies.root) && input.dependencies.root === input.envelope.dependencyRoot, input.dependencies.root),
    check("artifact", "evidenceReceipt", input.evidenceReceipts.length > 0, String(input.evidenceReceipts.length)),
    check("artifact", "tools", toolsPass(input.toolCalls, expectedTools, input.task.prohibitedActions ?? suiteTask?.prohibitedActions ?? []), input.toolCalls.join(",")),
    check("task", "successCriteria", taskEval.successCriteriaMatched.length === input.task.successCriteria.length, `${taskEval.successCriteriaMatched.length}/${input.task.successCriteria.length}`),
    check("task", "evidence", requiredEvidence.length === 0 || requiredEvidence.every(item => contains(output, item) || contains(envelopeText, item)), requiredEvidence.join(",")),
  ];

  let judge: SemanticJudgeRecordV1 | null = null;
  if (input.judge) {
    judge = await input.judge({ task: input.task, output: input.result.output, envelope: input.envelope });
    checks.push(check("judge", "semantic", judge.passed, judge.notes ?? "external-effect"));
  }

  const deterministic = checks.filter(item => item.phase !== "judge");
  const passed = deterministic.every(item => item.passed);
  return {
    status: taskEval.prohibitedViolations.length ? "failed" : input.result.status,
    successCriteriaMatched: taskEval.successCriteriaMatched,
    prohibitedViolations: taskEval.prohibitedViolations,
    passed,
    checks,
    judge,
  };
}

function check(phase: EvaluationCheckV1["phase"], id: string, passed: boolean, detail: string): EvaluationCheckV1 {
  return { phase, id, passed, detail };
}

function withinBudget(tokens: number | undefined, maxTokens: number | undefined): boolean {
  if (maxTokens === undefined || tokens === undefined) return true;
  return tokens <= maxTokens;
}

function matchesSchema(output: unknown, schema: unknown): boolean {
  if (schema === undefined) return true;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return output !== undefined;
  const type = (schema as { type?: unknown }).type;
  if (type === "object") return Boolean(output) && typeof output === "object" && !Array.isArray(output);
  if (type === "array") return Array.isArray(output);
  if (type === "string") return typeof output === "string";
  if (type === "number") return typeof output === "number";
  return output !== undefined;
}

function toolsPass(used: readonly string[], expected: readonly string[], prohibited: readonly string[]): boolean {
  if (used.some(tool => prohibited.includes(tool))) return false;
  return expected.every(tool => used.includes(tool));
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
