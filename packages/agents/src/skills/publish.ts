import { capabilityMetadataFromPack } from "../capabilities/pack.js";
import type { CapabilityMetadataV1 } from "../capabilities/types.js";
import { V5KnowledgeAdapter } from "../core-v5/knowledge.js";
import { gatesPass, type PromotionGatesV1, type SkillCandidateV1 } from "../experience/index.js";
import { canonicalJson, sha256Bytes } from "../harness/hash.js";
import { HarnessError } from "../harness/types.js";
import { parsePackSpec, validatePackManifest } from "../registry/spec.js";
import type { PackManifestV1, PackRegistryCapabilityV1, PackSpecV1 } from "../registry/types.js";
import { normalizeSkillDefinition } from "./definition.js";
import { normalizePublish } from "./policy.js";
import type { PublishPolicyV1, SkillDefinitionInputV1, SkillDefinitionV1 } from "./types.js";

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/,
  /kno_[A-Za-z0-9]{8,}/,
  /xai-[A-Za-z0-9]{8,}/,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /api[_-]?key\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /password\s*[:=]\s*\S+/i,
];

export type SkillPublishDecisionV1 = "proposed" | "published" | "denied";

export interface SkillPublishReceiptV1 {
  readonly version: 1;
  readonly decision: SkillPublishDecisionV1;
  readonly policy: PublishPolicyV1;
  readonly spec: string;
  readonly skillId: string;
  readonly lessonId: string | null;
  readonly sha256: string;
  readonly stateRoot: string | null;
  readonly secrets: "clean";
  readonly gates: PromotionGatesV1 | null;
  readonly evaluationPassed: boolean;
  readonly manifest: PackManifestV1 | null;
}

export interface BuiltCapabilityPackV1 {
  readonly spec: PackSpecV1;
  readonly pack: Record<string, unknown>;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly stateRoot: string;
  readonly manifest: PackManifestV1;
  readonly metadata: CapabilityMetadataV1;
}

export interface BuildCapabilityPackInput {
  readonly spec: string | PackSpecV1;
  readonly skill: SkillDefinitionInputV1 | SkillDefinitionV1;
  readonly description?: string;
  readonly license?: string;
  readonly knowledge?: V5KnowledgeAdapter;
}

export interface PublishLearnedSkillInput {
  readonly candidate: SkillCandidateV1;
  readonly spec: string | PackSpecV1;
  readonly registry: PackRegistryCapabilityV1;
  readonly policy?: PublishPolicyV1;
  readonly evaluation: { readonly passed: boolean };
  readonly approval?: boolean;
  readonly description?: string;
  readonly license?: string;
  readonly knowledge?: V5KnowledgeAdapter;
}

export function assertNoSecrets(value: unknown): void {
  const text = typeof value === "string" ? value : canonicalJson(value);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new HarnessError("capability pack contains a secret; secrets never enter .knolo bytes");
  }
}

export async function buildCapabilityPack(input: BuildCapabilityPackInput): Promise<BuiltCapabilityPackV1> {
  const spec = parsePackSpec(input.spec);
  const incoming = input.skill;
  const { contentHash: _ignored, ...body } = incoming;
  const skill = await normalizeSkillDefinition({
    ...body,
    provenance: {
      source: "local-pack",
      packId: spec.name,
      publisher: spec.publisher,
    },
  });
  const pack = {
    version: 1,
    id: spec.name,
    metadata: {
      name: skill.name ?? skill.id,
      description: [skill.id, input.description ?? skill.instructions].join(" "),
    },
    authority: {
      capabilities: [...skill.requiredCapabilities],
      namespaces: [],
    },
    tools: [...skill.requiredTools],
    namespaces: [],
    license: input.license ?? "Apache-2.0",
    role: "skill",
    skills: [
      {
        ...skill,
        provenance: {
          source: "local-pack" as const,
          packId: spec.name,
          publisher: spec.publisher,
        },
      },
    ],
  };
  assertNoSecrets(pack);
  const knowledge = input.knowledge ?? await V5KnowledgeAdapter.create();
  const document = new TextEncoder().encode(canonicalJson(pack));
  const handle = knowledge.createImage(
    [
      { kind: "knolo.pack", bytes: document, meta: { packId: spec.name, role: "skill", skillId: skill.id } },
      { kind: "knolo.skill", bytes: new TextEncoder().encode(canonicalJson(skill)), meta: { skillId: skill.id } },
    ],
    spec.publisher,
  );
  const sha256 = await sha256Bytes(handle.bytes);
  const verified = knowledge.verify(handle.bytes);
  if (verified.stateRoot !== handle.stateRoot) throw new HarnessError("capability pack Core stateRoot mismatch after verify");
  const manifest: PackManifestV1 = {
    name: spec.name,
    version: spec.version === "latest" ? skill.skillVersion : spec.version,
    sha256,
    stateRoot: handle.stateRoot,
    url: `memory://packs/sha256/${sha256}`,
    license: input.license ?? "Apache-2.0",
    sizeBytes: handle.bytes.byteLength,
    yanked: false,
    format: "V5",
  };
  return {
    spec: { ...spec, version: manifest.version },
    pack,
    bytes: handle.bytes,
    sha256,
    stateRoot: handle.stateRoot,
    manifest,
    metadata: capabilityMetadataFromPack(pack),
  };
}

export async function decodeCapabilityPack(
  bytes: Uint8Array,
  options: { packId?: string; digest?: string; knowledge?: V5KnowledgeAdapter } = {},
): Promise<CapabilityMetadataV1> {
  const json = tryJsonPack(bytes);
  if (json) {
    const pack = options.packId && !(json as { id?: string }).id ? { ...(json as Record<string, unknown>), id: options.packId } : json;
    return stamp(capabilityMetadataFromPack(pack), options.digest);
  }
  const knowledge = options.knowledge ?? await V5KnowledgeAdapter.create();
  const handle = knowledge.mount(bytes);
  const objects = knowledge.objects(handle);
  const packObject = objects.find(item => item.kind === "knolo.pack") ?? objects.find(item => item.kind === "metadata");
  if (!packObject) throw new HarnessError("capability pack image has no knolo.pack object");
  const parsed = JSON.parse(packObject.text) as unknown;
  const pack = options.packId && !(parsed as { id?: string }).id
    ? { ...(parsed as Record<string, unknown>), id: options.packId }
    : parsed;
  return stamp(capabilityMetadataFromPack(pack), options.digest ?? handle.stateRoot);
}

export async function publishLearnedSkill(input: PublishLearnedSkillInput): Promise<SkillPublishReceiptV1> {
  const policy = normalizePublish(input.policy);
  const spec = parsePackSpec(input.spec);
  const specName = `${spec.name}@${spec.version === "latest" ? input.candidate.skill.skillVersion : spec.version}`;
  if (policy === "disabled") throw new HarnessError("skill publish is disabled");
  if (input.candidate.status !== "promoted") throw new HarnessError("only a promoted skill candidate can be published");
  if (!gatesPass(input.candidate.gates) || input.evaluation.passed !== true) {
    throw new HarnessError("skill publish requires usefulness, evaluation, provenance, and a passing evaluation receipt");
  }
  if (policy === "authorized" && input.approval !== true) {
    throw new HarnessError("authorized skill publish requires explicit approval");
  }
  const built = await buildCapabilityPack({
    spec,
    skill: input.candidate.skill,
    description: input.description,
    license: input.license,
    knowledge: input.knowledge,
  });
  const base = {
    version: 1 as const,
    policy,
    spec: specName,
    skillId: input.candidate.skill.id,
    lessonId: input.candidate.lessonId,
    sha256: built.sha256,
    stateRoot: built.stateRoot,
    secrets: "clean" as const,
    gates: input.candidate.gates,
    evaluationPassed: true,
  };
  if (policy === "propose-only") {
    return { ...base, decision: "proposed", manifest: built.manifest };
  }
  if (typeof input.registry.publish !== "function") {
    throw new HarnessError("registry publish is not available; authorized publish requires PackRegistryCapabilityV1.publish");
  }
  const manifest = validatePackManifest(await input.registry.publish({
    manifest: built.manifest,
    bytes: built.bytes,
    description: input.description ?? String(built.pack.metadata && typeof built.pack.metadata === "object"
      ? (built.pack.metadata as { description?: string }).description
      : built.metadata.packId),
  }));
  if (manifest.sha256 !== built.sha256) throw new HarnessError("published manifest sha256 does not match built capability pack");
  return { ...base, decision: "published", manifest };
}

function tryJsonPack(bytes: Uint8Array): unknown | null {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function stamp(metadata: CapabilityMetadataV1, digest?: string): CapabilityMetadataV1 {
  if (metadata.skills.length === 0) throw new HarnessError("capability pack contains no skills");
  return {
    ...metadata,
    ...(digest ? { digest: metadata.digest ?? digest } : {}),
    skills: metadata.skills.map(skill => ({
      ...skill,
      provenance: skill.provenance ?? { source: "local-pack" as const, packId: metadata.packId, ...(digest ? { digest } : {}) },
    })),
  };
}
