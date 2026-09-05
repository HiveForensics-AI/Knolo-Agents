import type { JsonValue } from "../contracts/index.js";
import { computeHarnessDependencyRoot, type PackDependencyV1 } from "../dependencies/index.js";
import { sha256Bytes } from "./hash.js";
import { stringifyOutput } from "./task.js";
import type {
  AgentAdapter,
  AgentCapabilitiesV1,
  ContextEnvelopeV1,
  EvaluationReceiptV1,
  HarnessBudgetV1,
  InvocationStatusV1,
  TaskV1,
} from "./types.js";
import { HarnessError } from "./types.js";

export function assertAdapterSupportsTask(adapter: AgentAdapter, task: TaskV1): void {
  const capabilities = adapter.capabilities();
  const required = task.requiredCapabilities ?? [];
  if (required.includes("tools") && !capabilities.tools) {
    throw new HarnessError("adapter does not support tool gating; unsupported gating fails closed");
  }
  if (required.includes("resume") && !capabilities.resume) {
    throw new HarnessError("adapter does not support resume; unsupported gating fails closed");
  }
}

export function emptyEnvelope(task: TaskV1, capabilities: AgentCapabilitiesV1, budget: HarnessBudgetV1, dependencyRoot: string): ContextEnvelopeV1 {
  return {
    task,
    evidence: [],
    memories: [],
    skills: [],
    constraints: task.constraints ?? [],
    capabilities,
    budget,
    dependencyRoot,
    receipts: [],
  };
}

export function evaluateInvocation(task: TaskV1, status: InvocationStatusV1, output: unknown, toolCalls: readonly string[] = []): EvaluationReceiptV1 {
  const text = stringifyOutput(output);
  const matched = task.successCriteria.filter(criterion => contains(text, criterion));
  const prohibited = task.prohibitedActions ?? [];
  const violations = prohibited.filter(action => contains(text, action) || toolCalls.includes(action));
  const passed = violations.length === 0 && status !== "failed";
  return {
    status: violations.length ? "failed" : status,
    successCriteriaMatched: matched,
    prohibitedViolations: violations,
    passed,
    checks: [
      { phase: "contract", id: "policy", passed: violations.length === 0, detail: violations.join(",") || "ok" },
      { phase: "task", id: "successCriteria", passed: matched.length === task.successCriteria.length, detail: `${matched.length}/${task.successCriteria.length}` },
    ],
    judge: null,
  };
}

export async function freezeDependencyRoot(
  knowledge: readonly string[] = [],
  skills: readonly string[] = [],
  packs: readonly string[] = [],
): Promise<string> {
  const dependencies: PackDependencyV1[] = [];
  for (const name of knowledge) {
    dependencies.push({ name, version: "local", sha256: await sha256Bytes(new TextEncoder().encode(name)), role: "knowledge" });
  }
  for (const sha256 of skills) {
    dependencies.push({ name: sha256, version: "local", sha256, role: "skill" });
  }
  for (const sha256 of packs) {
    dependencies.push({ name: sha256, version: "lock", sha256, role: "knowledge" });
  }
  return (await computeHarnessDependencyRoot(dependencies)).root;
}

export function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
