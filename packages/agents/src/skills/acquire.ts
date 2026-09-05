import { uniqueSorted } from "../capabilities/authority.js";
import type { CapabilityIndex } from "../capabilities/catalog.js";
import type { CapabilityMetadataV1, EffectiveAuthorityV1 } from "../capabilities/types.js";
import { decodeCapabilityPack } from "./publish.js";
import { lexicalScore } from "../context/lexical.js";
import { packDependencyFromManifest, type DependencyActivation } from "../dependencies/index.js";
import { HarnessError } from "../harness/types.js";
import type { TaskV1 } from "../harness/types.js";
import type { PackRegistryCapabilityV1, PackSearchHitV1 } from "../registry/types.js";
import { capabilityGaps, emptyAcquisition, missingPreferredSkills, normalizePublish } from "./policy.js";
import type {
  SkillAcquisitionCandidateV1,
  SkillAcquisitionReceiptV1,
  SkillAcquisitionStagedV1,
  SkillDefinitionInputV1,
  SkillSelectedV1,
  SkillTrustPolicyV1,
} from "./types.js";

const MAX_PULLS = 8;

export interface AcquireSkillsInput {
  readonly task: TaskV1;
  readonly index: CapabilityIndex;
  readonly authority: EffectiveAuthorityV1;
  readonly trust: SkillTrustPolicyV1;
  readonly registry: PackRegistryCapabilityV1;
  readonly activation: DependencyActivation;
  readonly selected?: readonly SkillSelectedV1[];
  readonly verifyImage?: (bytes: Uint8Array) => Promise<void> | void;
}

export interface AcquiredSkills {
  readonly receipt: SkillAcquisitionReceiptV1;
  readonly packs: readonly CapabilityMetadataV1[];
}

export async function acquireSkills(input: AcquireSkillsInput): Promise<AcquiredSkills> {
  const registryMode = input.trust.registry;
  const publish = normalizePublish(input.trust.publish);
  const selectedIds = (input.selected ?? []).map(item => item.id);
  const gaps = capabilityGaps(input.task, input.index, selectedIds);
  const missingSkills = missingPreferredSkills(input.task, input.index);
  if (registryMode === "disabled") {
    return { receipt: emptyAcquisition(registryMode, publish, gaps, missingSkills), packs: [] };
  }
  if (gaps.length === 0 && missingSkills.length === 0) {
    return { receipt: emptyAcquisition(registryMode, publish, gaps, missingSkills), packs: [] };
  }
  if (registryMode === "acquire-approved" && (input.trust.allowlist ?? []).length === 0) {
    throw new HarnessError("acquire-approved requires a pack allowlist");
  }

  const queries = searchQueries(gaps, missingSkills);
  const hits = await collectHits(input.registry, queries);
  const ranked = rankHits(hits, input.task, gaps, missingSkills);
  const candidates: SkillAcquisitionCandidateV1[] = [];
  const staged: SkillAcquisitionStagedV1[] = [];
  const packs: CapabilityMetadataV1[] = [];
  let remainingGaps = [...gaps];
  let remainingPins = [...missingSkills];
  let pulls = 0;
  let pulled = false;

  for (const item of ranked) {
    if (remainingGaps.length === 0 && remainingPins.length === 0) break;
    if (item.hit.yanked) {
      candidates.push(candidate(item, "skipped", "yanked"));
      continue;
    }
    if (registryMode === "acquire-approved" && !allowlisted(item.hit.name, item.hit.version, input.trust.allowlist ?? [])) {
      candidates.push(candidate(item, "skipped", "policy"));
      continue;
    }
    if (input.index.hasPack(item.hit.name) || packs.some(pack => pack.packId === item.hit.name)) {
      candidates.push(candidate(item, "skipped", "duplicate"));
      continue;
    }
    if (registryMode === "discover") {
      candidates.push(candidate(item, "discover"));
      continue;
    }
    if (pulls >= MAX_PULLS) {
      candidates.push(candidate(item, "skipped", "budget"));
      continue;
    }
    pulls += 1;
    let bytes: Uint8Array;
    try {
      const result = await input.registry.pull(`${item.hit.name}@${item.hit.version}`);
      bytes = result.bytes;
      pulled = true;
    } catch (error) {
      candidates.push(candidate(item, "skipped", error instanceof Error ? error.message : String(error)));
      continue;
    }
    const metadata = await inspectPack(bytes, item.hit, input.verifyImage);
    if (!metadata) {
      candidates.push(candidate(item, "skipped", "unreadable"));
      continue;
    }
    const covering = coveringSkills(metadata.skills, remainingGaps, remainingPins);
    if (covering.length === 0) {
      candidates.push(candidate(item, "skipped", "no_cover"));
      continue;
    }
    const usable = covering.filter(skill => authorized(skill, input.authority));
    if (usable.length === 0) {
      candidates.push(candidate(item, "skipped", "authority"));
      continue;
    }
    if (usable.some(skill => input.index.skill(skill.id)) || packs.some(pack => pack.skills.some(skill => usable.some(item => item.id === skill.id)))) {
      candidates.push(candidate(item, "skipped", "duplicate"));
      continue;
    }
    const dependency = packDependencyFromManifest(
      {
        name: item.hit.name,
        version: item.hit.version,
        sha256: item.hit.sha256,
        ...(item.hit.stateRoot ? { stateRoot: item.hit.stateRoot } : {}),
        url: "",
        sizeBytes: bytes.byteLength,
        yanked: false,
        ...(item.hit.license ? { license: item.hit.license } : {}),
      },
      "skill",
    );
    input.activation.stage(dependency);
    staged.push({ name: dependency.name, version: dependency.version, sha256: dependency.sha256, role: "skill" });
    packs.push(metadata);
    remainingGaps = remainingGaps.filter(gap => !usable.some(skill => (skill.requiredCapabilities ?? []).includes(gap)));
    remainingPins = remainingPins.filter(id => !usable.some(skill => skill.id === id));
    candidates.push(candidate(item, "staged"));
  }

  const receipt: SkillAcquisitionReceiptV1 = {
    version: 1,
    registry: registryMode,
    publish,
    gaps,
    missingSkills,
    queried: true,
    pulled,
    staged,
    candidates,
  };
  return { receipt, packs };
}

function searchQueries(gaps: readonly string[], missingSkills: readonly string[]): string[] {
  const parts = uniqueSorted([...gaps, ...missingSkills]);
  const combined = parts.join(" ");
  return uniqueSorted([combined, ...parts]).filter(Boolean);
}

async function collectHits(registry: PackRegistryCapabilityV1, queries: readonly string[]): Promise<PackSearchHitV1[]> {
  const map = new Map<string, PackSearchHitV1>();
  for (const query of queries) {
    const hits = await registry.search({ q: query });
    for (const hit of hits) map.set(`${hit.name}@${hit.version}`, hit);
  }
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function rankHits(
  hits: readonly PackSearchHitV1[],
  task: TaskV1,
  gaps: readonly string[],
  missingSkills: readonly string[],
): { hit: PackSearchHitV1; score: number }[] {
  const query = [task.objective, ...gaps, ...missingSkills].join(" ");
  return hits
    .map(hit => ({
      hit,
      score: lexicalScore(query, `${hit.name} ${hit.publisher} ${hit.slug} ${hit.description ?? ""} ${gaps.join(" ")}`),
    }))
    .sort((left, right) => right.score - left.score || left.hit.name.localeCompare(right.hit.name) || left.hit.version.localeCompare(right.hit.version));
}

function allowlisted(name: string, version: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(name) || allowlist.includes(`${name}@${version}`);
}

function coveringSkills(
  skills: readonly SkillDefinitionInputV1[],
  gaps: readonly string[],
  missingSkills: readonly string[],
): SkillDefinitionInputV1[] {
  return skills.filter(skill => missingSkills.includes(skill.id) || (skill.requiredCapabilities ?? []).some(item => gaps.includes(item)));
}

function authorized(skill: SkillDefinitionInputV1, authority: EffectiveAuthorityV1): boolean {
  return (skill.requiredCapabilities ?? []).every(item => authority.capabilities.includes(item))
    && (skill.requiredTools ?? []).every(item => authority.tools.includes(item));
}

async function inspectPack(
  bytes: Uint8Array,
  hit: PackSearchHitV1,
  verifyImage?: (bytes: Uint8Array) => Promise<void> | void,
): Promise<CapabilityMetadataV1 | null> {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text.startsWith("{") && verifyImage) {
    try {
      await verifyImage(bytes);
    } catch {
      return null;
    }
  }
  try {
    return await decodeCapabilityPack(bytes, { packId: hit.name, digest: hit.sha256 });
  } catch {
    return null;
  }
}

function candidate(
  item: { hit: PackSearchHitV1; score: number },
  decision: SkillAcquisitionCandidateV1["decision"],
  reason?: string,
): SkillAcquisitionCandidateV1 {
  return {
    name: item.hit.name,
    version: item.hit.version,
    sha256: item.hit.sha256,
    score: item.score,
    decision,
    ...(reason ? { reason } : {}),
  };
}
