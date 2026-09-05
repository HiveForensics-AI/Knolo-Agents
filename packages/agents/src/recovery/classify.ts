import { stringifyOutput } from "../harness/task.js";
import type { AgentInvocationResultV1 } from "../harness/types.js";
import type { FailureClassV1 } from "./types.js";

export function classifyFailure(result: AgentInvocationResultV1): FailureClassV1 {
  const text = `${result.error ?? ""} ${stringifyOutput(result.output)}`.toLowerCase();
  if (/timeout|etimedout|timed out|tool_timeout/.test(text)) return "timeout";
  if (/prohibited|denied|authority|policy|escalation/.test(text)) return "policy";
  if (/schema|outputschema|parse json|invalid json/.test(text)) return "schema";
  if (/retriev|evidence|knowledge image/.test(text)) return "retrieval";
  if (/tool/.test(text)) return "tool";
  if (/model|llm|completion/.test(text)) return "model";
  return "unknown";
}

export function needsRecovery(result: AgentInvocationResultV1): boolean {
  return result.status === "failed";
}
