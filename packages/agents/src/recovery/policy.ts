import { HarnessError } from "../harness/types.js";
import { DEFAULT_RECOVERY_STRATEGIES, type FailureClassV1, type RecoveryPolicyV1, type RecoveryStrategyV1 } from "./types.js";

export function parseRecoveryPolicy(value: unknown): RecoveryPolicyV1 {
  if (value === undefined || value === null || value === true) {
    return { enabled: true, maxRetries: 1, strategies: DEFAULT_RECOVERY_STRATEGIES };
  }
  if (value === false) return { enabled: false, maxRetries: 0, strategies: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("recovery must be a policy object, true, or false");
  const record = value as RecoveryPolicyV1;
  const maxRetries = record.maxRetries ?? 1;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new HarnessError("recovery.maxRetries must be a non-negative integer");
  const strategies = record.strategies ?? DEFAULT_RECOVERY_STRATEGIES;
  if (!Array.isArray(strategies) || strategies.some(item => !DEFAULT_RECOVERY_STRATEGIES.includes(item))) {
    throw new HarnessError("recovery.strategies contains an unknown strategy");
  }
  return {
    enabled: record.enabled !== false,
    maxRetries,
    strategies,
    ...(record.fallbackSkill ? { fallbackSkill: record.fallbackSkill } : {}),
    ...(record.alternateTool ? { alternateTool: record.alternateTool } : {}),
  };
}

export function nextStrategy(
  policy: RecoveryPolicyV1,
  failureClass: FailureClassV1,
  used: readonly RecoveryStrategyV1[],
): RecoveryStrategyV1 | null {
  if (policy.enabled === false) return null;
  if (failureClass === "policy") return null;
  const maxRetries = policy.maxRetries ?? 1;
  for (const strategy of policy.strategies ?? DEFAULT_RECOVERY_STRATEGIES) {
    if (strategy === "retry") {
      if (used.filter(item => item === "retry").length >= maxRetries) continue;
      return strategy;
    }
    if (used.includes(strategy)) continue;
    if (strategy === "fallback-skill" && !policy.fallbackSkill) continue;
    if (strategy === "alternate-tool" && !policy.alternateTool) continue;
    if (strategy === "hitl") continue;
    if (strategy === "narrowed-child") continue;
    return strategy;
  }
  return null;
}
