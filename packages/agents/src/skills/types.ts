import type { JsonValue } from "../contracts/index.js";
import type { SkillItemV1 } from "../context/types.js";

export interface SkillProvenanceV1 {
  readonly source: "local-pack";
  readonly packId: string;
  readonly digest?: string;
  readonly publisher?: string;
}

export interface SkillSchemasV1 {
  readonly input?: JsonValue;
  readonly output?: JsonValue;
}

export interface SkillDefinitionV1 {
  readonly version: 1;
  readonly id: string;
  readonly skillVersion: string;
  readonly name?: string;
  readonly triggers: readonly string[];
  readonly domains: readonly string[];
  readonly schemas?: SkillSchemasV1;
  readonly instructions: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredTools: readonly string[];
  readonly knowledgeRefs: readonly string[];
  readonly provenance: SkillProvenanceV1;
  readonly contentHash: string;
}

export type SkillDefinitionInputV1 = Omit<SkillDefinitionV1, "contentHash"> & {
  readonly contentHash?: string;
};

export type RegistryModeV1 = "disabled" | "discover" | "acquire-approved" | "acquire-any-verified";

export type PublishPolicyV1 = "propose-only" | "disabled" | "authorized";

export interface SkillTrustPolicyV1 {
  readonly registry: RegistryModeV1;
  readonly allowlist?: readonly string[];
  readonly publish?: PublishPolicyV1;
}

export type SkillResolutionModeV1 = "none" | "local" | "auto";

export interface SkillResolutionOptions {
  readonly resolution?: SkillResolutionModeV1;
  readonly registry?: boolean | RegistryModeV1;
  readonly allowlist?: readonly string[];
  readonly publish?: PublishPolicyV1;
  readonly index?: unknown;
  readonly packs?: readonly unknown[];
  readonly definitions?: readonly SkillDefinitionInputV1[];
}

export type HarnessSkillsInput = SkillResolutionOptions | readonly SkillItemV1[] | readonly SkillDefinitionInputV1[];

export type SkillRejectReasonV1 = "authority" | "missing" | "hash" | "policy";

export type SkillAcquisitionDecisionV1 = "staged" | "discover" | "skipped";

export interface SkillAcquisitionCandidateV1 {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
  readonly score: number;
  readonly decision: SkillAcquisitionDecisionV1;
  readonly reason?: string;
}

export interface SkillAcquisitionStagedV1 {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
  readonly role: "skill";
}

export interface SkillAcquisitionReceiptV1 {
  readonly version: 1;
  readonly registry: RegistryModeV1;
  readonly publish: PublishPolicyV1;
  readonly gaps: readonly string[];
  readonly missingSkills: readonly string[];
  readonly queried: boolean;
  readonly pulled: boolean;
  readonly staged: readonly SkillAcquisitionStagedV1[];
  readonly candidates: readonly SkillAcquisitionCandidateV1[];
}

export interface SkillRankV1 {
  readonly id: string;
  readonly score: number;
}

/** @deprecated Use SkillRankV1. Ranking rows on SkillSelectionReceiptV1. */
export type SkillCandidateV1 = SkillRankV1;

export interface SkillSelectedV1 {
  readonly id: string;
  readonly skillVersion: string;
  readonly packId: string;
  readonly score: number;
  readonly required: boolean;
  readonly contentHash: string;
}

export interface SkillRejectedV1 {
  readonly id: string;
  readonly reason: SkillRejectReasonV1;
}

export interface SkillSelectionReceiptV1 {
  readonly version: 1;
  readonly query: string;
  readonly lexical: true;
  readonly resolution: SkillResolutionModeV1;
  readonly registry: RegistryModeV1;
  readonly selected: readonly SkillSelectedV1[];
  readonly rejected: readonly SkillRejectedV1[];
  readonly candidates: readonly SkillCandidateV1[];
  readonly authority: { readonly capabilities: readonly string[]; readonly tools: readonly string[] };
  readonly acquisition: SkillAcquisitionReceiptV1;
}

export type { SkillItemV1 };
