import type { SkillDefinitionInputV1, SkillDefinitionV1 } from "../skills/types.js";

export type CapabilityRoleV1 = "knowledge" | "skill" | "policy" | "evaluation" | "workflow";

export interface CapabilityMetadataV1 {
  readonly version: 1;
  readonly packId: string;
  readonly digest?: string;
  readonly role: CapabilityRoleV1;
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly namespaces: readonly string[];
  readonly skills: readonly (SkillDefinitionV1 | SkillDefinitionInputV1)[];
  readonly license?: string;
}

export interface AuthorityGrantV1 {
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly namespaces?: readonly string[];
}

export interface EffectiveAuthorityV1 {
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly namespaces: readonly string[];
}
