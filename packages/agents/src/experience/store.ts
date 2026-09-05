import { lexicalScore } from "../context/lexical.js";
import type { MemoryItemV1, MemorySourceV1 } from "../context/types.js";
import { HarnessError } from "../harness/types.js";
import { normalizeSkillDefinition } from "../skills/definition.js";
import {
  boundExperienceText,
  draftSkillFromLesson,
  evaluateGates,
  gatesPass,
  isUsefulExperience,
  lessonFromUseful,
  patternKey,
} from "./promote.js";
import type {
  ExperiencePolicyV1,
  ExperiencePromoteModeV1,
  ExperienceReceiptV1,
  ExperienceRecordV1,
  ExperienceSnapshotV1,
  LessonCandidateV1,
  RecordExperienceInput,
  SkillCandidateV1,
} from "./types.js";
import type { SkillDefinitionV1 } from "../skills/types.js";

const DEFAULT_MIN_USEFULNESS = 2;
const DEFAULT_MAX_RECORDS = 64;

export interface LocalExperienceOptions extends ExperiencePolicyV1 {
  readonly remember?: (text: string, labels?: readonly string[]) => unknown;
  readonly authorityCapabilities?: readonly string[];
}

export function normalizeExperiencePolicy(
  experience: ExperiencePolicyV1 | undefined,
  memory: unknown,
): Required<Pick<ExperiencePolicyV1, "enabled" | "promote" | "minUsefulness" | "publish" | "maxRecords">> {
  const memoryOn = memory === true || isCortex(memory);
  const enabled = experience?.enabled ?? memoryOn;
  const promote: ExperiencePromoteModeV1 = experience?.promote ?? "require-approval";
  const minUsefulness = experience?.minUsefulness ?? DEFAULT_MIN_USEFULNESS;
  if (experience?.publish !== undefined && experience.publish !== "disabled") {
    throw new HarnessError("experience publish is disabled; public Hub publish is not available");
  }
  if (!Number.isSafeInteger(minUsefulness) || minUsefulness < 1) {
    throw new HarnessError("experience.minUsefulness must be a positive integer");
  }
  const maxRecords = experience?.maxRecords ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new HarnessError("experience.maxRecords must be a positive integer");
  }
  return { enabled, promote, minUsefulness, publish: "disabled", maxRecords };
}

export function isCortex(value: unknown): value is { query: (request: unknown) => Promise<unknown> } {
  return Boolean(value && typeof value === "object" && typeof (value as { query?: unknown }).query === "function");
}

export function canRemember(value: unknown): value is { remember: (text: string, labels?: readonly string[]) => unknown } {
  return Boolean(value && typeof value === "object" && typeof (value as { remember?: unknown }).remember === "function");
}

export class LocalExperience implements MemorySourceV1 {
  private readonly records: ExperienceRecordV1[] = [];
  private readonly lessonsByKey = new Map<string, LessonCandidateV1>();
  private readonly candidatesByLesson = new Map<string, SkillCandidateV1>();
  private readonly promotedSkills: SkillDefinitionV1[] = [];
  private readonly approvals = new Set<string>();
  private readonly policy: ReturnType<typeof normalizeExperiencePolicy>;
  private readonly remember?: (text: string, labels?: readonly string[]) => unknown;
  private readonly authorityCapabilities: readonly string[];

  constructor(options: LocalExperienceOptions = {}, memory: unknown = undefined) {
    this.policy = normalizeExperiencePolicy(options, memory);
    this.remember = options.remember;
    this.authorityCapabilities = options.authorityCapabilities ?? [];
  }

  get enabled(): boolean {
    return this.policy.enabled;
  }

  snapshot(): ExperienceSnapshotV1 {
    return {
      records: this.records.slice(),
      lessons: [...this.lessonsByKey.values()].sort((left, right) => left.id.localeCompare(right.id)),
      candidates: [...this.candidatesByLesson.values()].sort((left, right) => left.id.localeCompare(right.id)),
      promoted: this.promotedSkills.slice(),
    };
  }

  promoted(): readonly SkillDefinitionV1[] {
    return this.promotedSkills;
  }

  recall(query: string): readonly MemoryItemV1[] {
    return this.records
      .filter(item => item.useful)
      .map(item => ({ id: item.id, text: item.text, score: lexicalScore(query, item.text) }))
      .filter(item => (item.score ?? 0) > 0)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id));
  }

  async approve(id: string): Promise<SkillCandidateV1 | null> {
    this.approvals.add(id);
    const lesson = [...this.lessonsByKey.values()].find(item => item.id === id);
    if (!lesson) return this.candidatesByLesson.get(id) ?? null;
    return this.syncCandidate(lesson);
  }

  async record(input: RecordExperienceInput): Promise<ExperienceReceiptV1> {
    if (!this.policy.enabled) {
      return emptyReceipt();
    }
    const key = await patternKey(input.task);
    const useful = isUsefulExperience({
      status: input.status,
      successCriteria: input.task.successCriteria,
      successCriteriaMatched: input.successCriteriaMatched,
      prohibitedViolations: input.prohibitedViolations,
    });
    const record: ExperienceRecordV1 = {
      version: 1,
      id: `experience/${input.runId}/${this.records.length + 1}`,
      runId: input.runId,
      sequence: this.records.length + 1,
      patternKey: key,
      objective: input.task.objective,
      successCriteria: [...input.task.successCriteria],
      status: input.status,
      useful,
      text: boundExperienceText(input.task, input.output, input.skillIds ?? []),
      skillIds: [...(input.skillIds ?? [])].sort(),
      requiredCapabilities: [...(input.task.requiredCapabilities ?? [])].sort(),
      evidenceIds: [...(input.evidenceIds ?? [])].sort(),
      dependencyRoot: input.dependencyRoot,
      successCriteriaMatched: [...input.successCriteriaMatched],
      prohibitedViolations: [...input.prohibitedViolations],
      labels: [...(input.labels ?? [])].sort(),
    };
    this.records.push(record);
    if (this.records.length > this.policy.maxRecords) this.records.splice(0, this.records.length - this.policy.maxRecords);
    this.remember?.(record.text, ["experience", record.status, ...record.labels]);

    const related = this.records.filter(item => item.patternKey === key);
    const lesson = lessonFromUseful(related);
    if (lesson) this.lessonsByKey.set(key, lesson);
    const candidate = lesson && this.policy.promote !== "disabled" ? await this.syncCandidate(lesson) : null;

    return {
      version: 1,
      recorded: true,
      experienceId: record.id,
      lessonId: lesson?.id ?? null,
      candidateId: candidate?.id ?? null,
      promoted: candidate?.status === "promoted",
      publish: "disabled",
      gates: candidate?.gates ?? null,
    };
  }

  private async syncCandidate(lesson: LessonCandidateV1): Promise<SkillCandidateV1> {
    const autoApproved = this.policy.promote === "auto-approved";
    const approved = this.approvals.has(lesson.id);
    const gates = evaluateGates({
      lesson,
      minUsefulness: this.policy.minUsefulness,
      approved,
      autoApproved,
    });
    const existing = this.candidatesByLesson.get(lesson.id);
    if (existing?.status === "promoted") {
      const kept = { ...existing, gates };
      this.candidatesByLesson.set(lesson.id, kept);
      return kept;
    }
    const skill = draftSkillFromLesson(lesson, this.authorityCapabilities);
    const pass = this.policy.promote !== "disabled" && gatesPass(gates);
    const candidate: SkillCandidateV1 = {
      version: 1,
      id: skill.id,
      lessonId: lesson.id,
      skill,
      gates,
      status: this.policy.promote === "disabled" ? "rejected" : pass ? "promoted" : "candidate",
      publish: "disabled",
    };
    this.candidatesByLesson.set(lesson.id, candidate);
    if (candidate.status === "promoted") {
      const normalized = await normalizeSkillDefinition(skill);
      if (!this.promotedSkills.some(item => item.id === normalized.id)) this.promotedSkills.push(normalized);
    }
    return candidate;
  }
}

export function emptyReceipt(): ExperienceReceiptV1 {
  return {
    version: 1,
    recorded: false,
    experienceId: null,
    lessonId: null,
    candidateId: null,
    promoted: false,
    publish: "disabled",
    gates: null,
  };
}

export function localExperience(options: LocalExperienceOptions = {}, memory?: unknown): LocalExperience {
  return new LocalExperience(options, memory);
}
