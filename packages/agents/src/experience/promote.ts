import { normalizeText, tokenize } from "../context/lexical.js";
import { digestRoot } from "../harness/hash.js";
import { stringifyOutput } from "../harness/task.js";
import type { TaskV1 } from "../harness/types.js";
import type { SkillDefinitionInputV1 } from "../skills/types.js";
import type { ExperienceRecordV1, LessonCandidateV1, PromotionGatesV1 } from "./types.js";

const ADAPTER_CAPABILITIES = new Set(["tools", "resume", "observe", "interrupt"]);
const MAX_TEXT = 2000;
const MAX_TRIGGERS = 16;

export async function patternKey(task: Pick<TaskV1, "objective" | "successCriteria">): Promise<string> {
  return digestRoot("experience-pattern", {
    objective: normalizeText(task.objective),
    successCriteria: [...task.successCriteria].map(item => normalizeText(item)).sort(),
  });
}

export function isUsefulExperience(input: {
  readonly status: string;
  readonly successCriteria: readonly string[];
  readonly successCriteriaMatched: readonly string[];
  readonly prohibitedViolations: readonly string[];
}): boolean {
  return input.status === "succeeded"
    && input.prohibitedViolations.length === 0
    && input.successCriteria.length > 0
    && input.successCriteriaMatched.length === input.successCriteria.length;
}

export function boundExperienceText(task: Pick<TaskV1, "objective" | "successCriteria">, output: unknown, skillIds: readonly string[]): string {
  const text = [
    task.objective,
    ...task.successCriteria,
    ...skillIds,
    stringifyOutput(output),
  ].join("\n");
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT);
}

export function lessonFromUseful(records: readonly ExperienceRecordV1[]): LessonCandidateV1 | null {
  const useful = records.filter(item => item.useful);
  if (useful.length === 0) return null;
  const first = useful[0];
  const runIds = unique(useful.map(item => item.runId));
  const skillIds = unique(useful.flatMap(item => item.skillIds));
  const requiredCapabilities = intersect(useful.map(item => item.requiredCapabilities.filter(cap => !ADAPTER_CAPABILITIES.has(cap))));
  return {
    version: 1,
    id: `lesson/${first.patternKey.replace(/^experience-pattern:/, "").slice(0, 24)}`,
    patternKey: first.patternKey,
    objective: first.objective,
    successCriteria: first.successCriteria,
    experienceIds: useful.map(item => item.id),
    usefulness: useful.length,
    skillIds,
    requiredCapabilities,
    provenance: { source: "local-experience", runIds },
  };
}

export function draftSkillFromLesson(lesson: LessonCandidateV1, authorityCapabilities: readonly string[] = []): SkillDefinitionInputV1 {
  const hex = lesson.patternKey.replace(/^experience-pattern:/, "");
  const requiredCapabilities = unique(lesson.requiredCapabilities)
    .filter(item => !ADAPTER_CAPABILITIES.has(item) && (authorityCapabilities.length === 0 || authorityCapabilities.includes(item)));
  const triggers = unique([
    ...tokenize(lesson.objective),
    ...lesson.successCriteria.flatMap(item => tokenize(item)),
  ]).slice(0, MAX_TRIGGERS);
  return {
    version: 1,
    id: `learned/${hex.slice(0, 16)}`,
    skillVersion: "1.0.0",
    name: "Learned local pattern",
    triggers,
    domains: ["learned"],
    instructions: `Verified local pattern. Objective: ${lesson.objective}. Success criteria: ${lesson.successCriteria.join("; ")}. Repeat the successful approach. Do not perform prohibited actions.`,
    requiredCapabilities,
    requiredTools: [],
    knowledgeRefs: [],
    provenance: { source: "local-pack", packId: "local-experience" },
  };
}

export function evaluateGates(input: {
  readonly lesson: LessonCandidateV1;
  readonly minUsefulness: number;
  readonly approved: boolean;
  readonly autoApproved: boolean;
}): PromotionGatesV1 {
  const evaluation = input.lesson.usefulness > 0;
  const provenance = input.lesson.provenance.source === "local-experience" && input.lesson.provenance.runIds.length > 0;
  return {
    usefulness: input.lesson.usefulness >= input.minUsefulness,
    evaluation,
    provenance,
    approval: input.autoApproved || input.approved,
  };
}

export function gatesPass(gates: PromotionGatesV1): boolean {
  return gates.usefulness && gates.evaluation && gates.provenance && gates.approval;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function intersect(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return unique(first.filter(item => rest.every(list => list.includes(item))));
}
