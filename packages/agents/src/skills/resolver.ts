import { CapabilityIndex } from "../capabilities/catalog.js";
import type { EffectiveAuthorityV1 } from "../capabilities/types.js";
import type { SkillItemV1 } from "../context/types.js";
import { lexicalScore } from "../context/lexical.js";
import { HarnessError } from "../harness/types.js";
import type { TaskV1 } from "../harness/types.js";
import { normalizeSkillDefinition } from "./definition.js";
import { capabilityGaps, emptyAcquisition, missingPreferredSkills, normalizePublish, normalizeRegistry } from "./policy.js";
import type {
  SkillDefinitionInputV1,
  SkillRejectedV1,
  SkillResolutionModeV1,
  SkillResolutionOptions,
  SkillSelectedV1,
  SkillSelectionReceiptV1,
  SkillTrustPolicyV1,
} from "./types.js";
import type { CapabilityMetadataV1 } from "../capabilities/types.js";

const PREFERRED_BOOST = 1_000_000;
const CAPABILITY_BOOST = 1_000;

export interface ResolveSkillsInput {
  readonly task: TaskV1;
  readonly index: CapabilityIndex;
  readonly authority: EffectiveAuthorityV1;
  readonly trust?: SkillTrustPolicyV1;
  readonly resolution?: SkillResolutionModeV1;
}

export interface ResolvedSkills {
  readonly items: SkillItemV1[];
  readonly receipt: SkillSelectionReceiptV1;
}

export async function resolveSkills(input: ResolveSkillsInput): Promise<ResolvedSkills> {
  const registry = normalizeRegistry(input.trust?.registry ?? "disabled");
  const publish = normalizePublish(input.trust?.publish);
  const resolution = input.resolution ?? "local";
  const query = input.task.objective;
  const preferred = input.task.preferredSkills ?? [];
  const authority = {
    capabilities: [...input.authority.capabilities],
    tools: [...input.authority.tools],
  };
  if (resolution === "none") {
    return {
      items: [],
      receipt: emptyReceipt(
        query,
        resolution,
        registry,
        authority,
        emptyAcquisition(registry, publish, capabilityGaps(input.task, input.index, []), missingPreferredSkills(input.task, input.index)),
      ),
    };
  }

  const rejected: SkillRejectedV1[] = [];
  const ranked: { skill: Awaited<ReturnType<typeof normalizeSkillDefinition>>; score: number; required: boolean }[] = [];

  for (const pinned of preferred) {
    if (!input.index.skill(pinned)) {
      if (registry === "disabled") {
        throw new HarnessError(`pinned skill '${pinned}' is not in the local capability index`);
      }
      rejected.push({ id: pinned, reason: "missing" });
    }
  }

  for (const entry of input.index.skills()) {
    const skill = await normalizeSkillDefinition(entry.skill);
    const required = preferred.includes(skill.id);
    if (!authorized(skill, input.authority)) {
      if (required) {
        throw new HarnessError(`pinned skill '${skill.id}' is denied: required capabilities are not in effective authority`);
      }
      rejected.push({ id: skill.id, reason: "authority" });
      continue;
    }
    ranked.push({ skill, score: scoreSkill(skill, query, input.task, required), required });
  }

  ranked.sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
  const selectedRanked = ranked.filter(item => item.required || item.score > 0);
  const selected: SkillSelectedV1[] = selectedRanked.map(item => ({
    id: item.skill.id,
    skillVersion: item.skill.skillVersion,
    packId: item.skill.provenance.packId,
    score: item.score,
    required: item.required,
    contentHash: item.skill.contentHash,
  }));
  const items: SkillItemV1[] = selectedRanked.map(item => ({
    id: item.skill.id,
    text: item.skill.instructions,
    required: item.required,
    score: item.score,
    ...(item.skill.provenance.packId ? { sourceId: item.skill.provenance.packId } : {}),
  }));

  const receipt: SkillSelectionReceiptV1 = {
    version: 1,
    query,
    lexical: true,
    resolution,
    registry,
    selected,
    rejected: rejected.sort((left, right) => left.id.localeCompare(right.id)),
    candidates: ranked.map(item => ({ id: item.skill.id, score: item.score })),
    authority,
    acquisition: emptyAcquisition(
      registry,
      publish,
      capabilityGaps(input.task, input.index, selected.map(item => item.id)),
      missingPreferredSkills(input.task, input.index),
    ),
  };
  return { items, receipt };
}

export function parseHarnessSkills(value: unknown): {
  passthrough?: SkillItemV1[];
  options?: SkillResolutionOptions;
} {
  if (value === undefined || value === null) return {};
  if (Array.isArray(value)) {
    if (value.length === 0) return { passthrough: [] };
    if (value.every(isSkillDefinitionLike)) return { options: { resolution: "local", registry: "disabled", definitions: value as SkillDefinitionInputV1[] } };
    if (value.every(isSkillItemLike)) {
      return {
        passthrough: value.map(item => ({
          id: item.id,
          text: item.text,
          ...(item.required === true ? { required: true } : {}),
          ...(item.sourceId ? { sourceId: item.sourceId } : {}),
          ...(item.score !== undefined ? { score: item.score } : {}),
        })),
      };
    }
    throw new HarnessError("skills array must be SkillItemV1 or SkillDefinitionV1 objects");
  }
  if (typeof value !== "object") throw new HarnessError("skills must be an array or a resolution options object");
  return { options: value as SkillResolutionOptions };
}

export function indexFromOptions(options: SkillResolutionOptions): CapabilityIndex {
  let index: CapabilityIndex;
  if (options.index instanceof CapabilityIndex) {
    index = CapabilityIndex.from(options.index.metadata());
  } else if (Array.isArray(options.index) && options.index.length > 0 && isSkillDefinitionLike(options.index[0])) {
    index = CapabilityIndex.fromDefinitions(options.index as SkillDefinitionInputV1[]);
  } else if (Array.isArray(options.index)) {
    index = CapabilityIndex.from(options.index as CapabilityMetadataV1[]);
  } else {
    index = CapabilityIndex.empty();
  }
  if (options.packs) index.addPacks(options.packs);
  if (options.definitions) index.addDefinitions(options.definitions);
  return index;
}

function authorized(skill: { requiredCapabilities: readonly string[]; requiredTools: readonly string[] }, authority: EffectiveAuthorityV1): boolean {
  return skill.requiredCapabilities.every(item => authority.capabilities.includes(item))
    && skill.requiredTools.every(item => authority.tools.includes(item));
}

function scoreSkill(
  skill: { id: string; skillVersion: string; triggers: readonly string[]; domains: readonly string[]; instructions: string; requiredCapabilities: readonly string[] },
  query: string,
  task: TaskV1,
  preferred: boolean,
): number {
  const haystack = [skill.id, skill.skillVersion, ...skill.triggers, ...skill.domains, skill.instructions].join(" ");
  let score = lexicalScore(query, haystack);
  if (preferred) score += PREFERRED_BOOST;
  const needed = task.requiredCapabilities ?? [];
  const overlap = skill.requiredCapabilities.filter(item => needed.includes(item)).length;
  if (overlap) score += overlap * CAPABILITY_BOOST;
  return score;
}

function emptyReceipt(
  query: string,
  resolution: SkillResolutionModeV1,
  registry: SkillSelectionReceiptV1["registry"],
  authority: SkillSelectionReceiptV1["authority"],
  acquisition: SkillSelectionReceiptV1["acquisition"],
): SkillSelectionReceiptV1 {
  return {
    version: 1,
    query,
    lexical: true,
    resolution,
    registry,
    selected: [],
    rejected: [],
    candidates: [],
    authority,
    acquisition,
  };
}

function isSkillItemLike(value: unknown): value is SkillItemV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { id?: unknown; text?: unknown };
  return typeof record.id === "string" && typeof record.text === "string";
}

function isSkillDefinitionLike(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { id?: unknown; instructions?: unknown; skillVersion?: unknown };
  return typeof record.id === "string" && typeof record.instructions === "string" && typeof record.skillVersion === "string";
}

export { normalizeRegistry } from "./policy.js";
