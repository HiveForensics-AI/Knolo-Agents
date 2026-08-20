/** Product-level agent profiles. A profile describes intent; packs grant authority. */
export type AgentProfileKind = "coding" | "research" | "operations" | "custom";

export interface AutonomyLimits {
  maxTurns: number;
  maxActions: number;
  maxRetries: number;
  timeoutMs: number;
  requireApprovalForWrites: boolean;
}

export interface AgentProfile {
  version: 1;
  id: string;
  name: string;
  description: string;
  kind: AgentProfileKind;
  mission: string;
  capabilities: readonly string[];
  model?: string;
  autonomy: AutonomyLimits;
}

export function builtinAgentProfile(
  kind: AgentProfileKind,
  id = kind,
): AgentProfile {
  const common: Record<AgentProfileKind, Omit<AgentProfile, "version" | "id" | "kind" | "autonomy">> = {
    coding: {
      name: "Coding Agent",
      description: "A local software engineering agent.",
      mission: "Inspect a workspace, make approved changes, and verify the requested development task.",
      capabilities: ["workspace.read", "workspace.write", "process.execute"],
    },
    research: {
      name: "Research Agent",
      description: "A research and synthesis agent.",
      mission: "Gather approved evidence and return a concise, sourced answer.",
      capabilities: ["knowledge.read", "documents.read"],
    },
    operations: {
      name: "Operations Agent",
      description: "A governed business operations agent.",
      mission: "Complete approved operational workflows and report every external effect.",
      capabilities: ["operations.read", "operations.write"],
    },
    custom: {
      name: "Custom Agent",
      description: "A user-defined Knolo agent.",
      mission: "Complete the user-defined mission within the declared authority.",
      capabilities: ["state.read"],
    },
  };
  return {
    version: 1,
    id,
    kind,
    ...common[kind],
    autonomy: {
      maxTurns: 8,
      maxActions: 32,
      maxRetries: 1,
      timeoutMs: 300_000,
      requireApprovalForWrites: true,
    },
  };
}

export function validateAgentProfile(profile: AgentProfile): void {
  if (profile.version !== 1 || !profile.id || !profile.name || !profile.mission) {
    throw new Error("invalid agent profile");
  }
  if (profile.autonomy.maxTurns <= 0 || profile.autonomy.maxActions <= 0 || profile.autonomy.timeoutMs <= 0) {
    throw new Error("agent autonomy limits must be positive");
  }
}
