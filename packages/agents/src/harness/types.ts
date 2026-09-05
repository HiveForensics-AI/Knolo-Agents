import type { JsonValue } from "../contracts/index.js";

export type AssuranceLevelV1 = "L0" | "L1" | "L2" | "L3" | "platform";

export interface AgentDescriptorV1 {
  readonly version: 1;
  readonly id: string;
  readonly name?: string;
  readonly level: AssuranceLevelV1;
}

export interface AgentCapabilitiesV1 {
  readonly version: 1;
  readonly level: AssuranceLevelV1;
  readonly tools: boolean;
  readonly resume: boolean;
  readonly observe: boolean;
  readonly interrupt: boolean;
  readonly limitations: readonly string[];
}

export interface HarnessBudgetV1 {
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly maxCostMicros?: number;
  readonly timeoutMs?: number;
}

export interface ConstraintV1 {
  readonly id: string;
  readonly description: string;
}

export interface TaskV1 {
  readonly id?: string;
  readonly objective: string;
  readonly inputs?: JsonValue;
  readonly constraints?: readonly ConstraintV1[];
  readonly successCriteria: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly preferredSkills?: readonly string[];
  readonly prohibitedActions?: readonly string[];
  readonly budget?: HarnessBudgetV1;
  readonly deadlineMs?: number;
  readonly outputSchema?: JsonValue;
  readonly evidenceRequirements?: readonly string[];
}

export interface ContextEnvelopeV1 {
  readonly task: TaskV1;
  readonly evidence: readonly JsonValue[];
  readonly memories: readonly JsonValue[];
  readonly skills: readonly JsonValue[];
  readonly constraints: readonly ConstraintV1[];
  readonly capabilities: AgentCapabilitiesV1;
  readonly budget: HarnessBudgetV1;
  readonly dependencyRoot: string;
  readonly receipts: readonly string[];
}

export interface HarnessContextV1 {
  readonly runId: string;
  readonly task: TaskV1;
  readonly envelope: ContextEnvelopeV1;
  readonly signal?: AbortSignal;
  emitTool?(phase: "before" | "after", toolId: string, payload?: JsonValue): Promise<void>;
}

export type InvocationStatusV1 = "succeeded" | "partial" | "failed" | "suspended";

export interface AgentInvocationResultV1<O = unknown> {
  readonly status: InvocationStatusV1;
  readonly output: O;
  readonly error?: string;
  readonly toolCalls?: readonly string[];
  readonly tokens?: number;
  readonly events?: readonly JsonValue[];
}

export interface HarnessCheckpointV1 {
  readonly version: 1;
  readonly runId: string;
  readonly adapterId: string;
  readonly payload: JsonValue;
}

export type AgentEventSinkV1 = (event: JsonValue) => void;

export interface DisposableV1 {
  dispose(): void;
}

export interface AgentAdapter<I = unknown, O = unknown> {
  descriptor(): AgentDescriptorV1;
  capabilities(): AgentCapabilitiesV1;
  invoke(input: I, ctx: HarnessContextV1): Promise<AgentInvocationResultV1<O>>;
  interrupt?(): Promise<void>;
  resume?(checkpoint: HarnessCheckpointV1): Promise<AgentInvocationResultV1<O>>;
  observe?(sink: AgentEventSinkV1): Promise<DisposableV1> | DisposableV1;
}

export interface EvaluationCheckV1 {
  readonly phase: "contract" | "artifact" | "task" | "judge";
  readonly id: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface SemanticJudgeRecordV1 {
  readonly kind: "external-effect";
  readonly effect: "semantic-judge";
  readonly deterministic: false;
  readonly passed: boolean;
  readonly model?: string;
  readonly notes?: string;
}

export interface EvaluationReceiptV1 {
  readonly status: InvocationStatusV1;
  readonly successCriteriaMatched: readonly string[];
  readonly prohibitedViolations: readonly string[];
  readonly passed: boolean;
  readonly checks: readonly EvaluationCheckV1[];
  readonly judge: SemanticJudgeRecordV1 | null;
}

export interface HarnessRunReceiptV1 {
  readonly version: 1;
  readonly runId: string;
  readonly agentDescriptorHash: string;
  readonly taskRoot: string;
  readonly inputRoot: string;
  readonly knowledgeStateRoots: readonly string[];
  readonly harnessDependencyRoot: string;
  readonly authorityRoot: string;
  readonly skillSelectionReceipt: string | null;
  readonly evidenceReceipts: readonly string[];
  readonly toolReceipts: readonly string[];
  readonly evaluationReceipt: EvaluationReceiptV1;
  readonly recoveryEvents: readonly JsonValue[];
  readonly finalStatus: InvocationStatusV1;
  readonly output: unknown;
}

export class HarnessError extends Error {
  readonly type = "harness";
  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}
