export type FailureClassV1 = "tool" | "retrieval" | "schema" | "timeout" | "policy" | "model" | "unknown";

export type RecoveryStrategyV1 =
  | "retry"
  | "alternate-plan"
  | "fallback-skill"
  | "alternate-tool"
  | "narrowed-child"
  | "hitl"
  | "graceful-partial";

export interface RecoveryPolicyV1 {
  readonly enabled?: boolean;
  readonly maxRetries?: number;
  readonly strategies?: readonly RecoveryStrategyV1[];
  readonly fallbackSkill?: string;
  readonly alternateTool?: string;
}

export interface RecoveryEventV1 {
  readonly version: 1;
  readonly class: FailureClassV1;
  readonly strategy: RecoveryStrategyV1;
  readonly attempt: number;
  readonly status: "applied" | "skipped" | "exhausted";
  readonly detail?: string;
}

export const DEFAULT_RECOVERY_STRATEGIES: readonly RecoveryStrategyV1[] = [
  "retry",
  "alternate-plan",
  "fallback-skill",
  "alternate-tool",
  "narrowed-child",
  "hitl",
  "graceful-partial",
];
