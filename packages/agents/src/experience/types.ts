import type { MemoryItemV1 } from "../context/types.js";
import type { InvocationStatusV1, TaskV1 } from "../harness/types.js";
import type { SkillDefinitionInputV1, SkillDefinitionV1 } from "../skills/types.js";

export type ExperiencePromoteModeV1 = "disabled" | "require-approval" | "auto-approved";

export interface ExperiencePolicyV1 {
  readonly enabled?: boolean;
  readonly promote?: ExperiencePromoteModeV1;
  readonly minUsefulness?: number;
  readonly publish?: "disabled";
  readonly maxRecords?: number;
}

export interface ExperienceRecordV1 {
  readonly version: 1;
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly patternKey: string;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly status: InvocationStatusV1;
  readonly useful: boolean;
  readonly text: string;
  readonly skillIds: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly dependencyRoot: string;
  readonly successCriteriaMatched: readonly string[];
  readonly prohibitedViolations: readonly string[];
  readonly labels: readonly string[];
}

export interface LessonCandidateV1 {
  readonly version: 1;
  readonly id: string;
  readonly patternKey: string;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly experienceIds: readonly string[];
  readonly usefulness: number;
  readonly skillIds: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly provenance: { readonly source: "local-experience"; readonly runIds: readonly string[] };
}

export interface PromotionGatesV1 {
  readonly usefulness: boolean;
  readonly evaluation: boolean;
  readonly provenance: boolean;
  readonly approval: boolean;
}

export interface SkillCandidateV1 {
  readonly version: 1;
  readonly id: string;
  readonly lessonId: string;
  readonly skill: SkillDefinitionInputV1;
  readonly gates: PromotionGatesV1;
  readonly status: "candidate" | "promoted" | "rejected";
  readonly publish: "disabled";
}

export interface ExperienceReceiptV1 {
  readonly version: 1;
  readonly recorded: boolean;
  readonly experienceId: string | null;
  readonly lessonId: string | null;
  readonly candidateId: string | null;
  readonly promoted: boolean;
  readonly publish: "disabled";
  readonly gates: PromotionGatesV1 | null;
}

export interface ExperienceSnapshotV1 {
  readonly records: readonly ExperienceRecordV1[];
  readonly lessons: readonly LessonCandidateV1[];
  readonly candidates: readonly SkillCandidateV1[];
  readonly promoted: readonly SkillDefinitionV1[];
}

export interface RecordExperienceInput {
  readonly runId: string;
  readonly task: TaskV1;
  readonly status: InvocationStatusV1;
  readonly output: unknown;
  readonly successCriteriaMatched: readonly string[];
  readonly prohibitedViolations: readonly string[];
  readonly skillIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly dependencyRoot: string;
  readonly labels?: readonly string[];
}

export type { MemoryItemV1, SkillDefinitionV1 };
