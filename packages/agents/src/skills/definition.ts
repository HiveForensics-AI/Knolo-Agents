import { sha256Hex } from "../harness/hash.js";
import { HarnessError } from "../harness/types.js";
import type { SkillDefinitionInputV1, SkillDefinitionV1, SkillProvenanceV1, SkillSchemasV1 } from "./types.js";

const identifier = /^[A-Za-z0-9_.\/-]{1,128}$/;

export async function hashSkillDefinition(skill: SkillDefinitionInputV1 | SkillDefinitionV1): Promise<string> {
  const { contentHash: _ignored, ...body } = skill;
  return sha256Hex(body);
}

export async function normalizeSkillDefinition(input: SkillDefinitionInputV1 | SkillDefinitionV1): Promise<SkillDefinitionV1> {
  const skill = validateSkillShape(input);
  const contentHash = await hashSkillDefinition(skill);
  if (skill.contentHash && skill.contentHash !== contentHash) {
    throw new HarnessError(`skill '${skill.id}' contentHash does not match canonical definition`);
  }
  return { ...skill, contentHash };
}

export function validateSkillShape(input: SkillDefinitionInputV1 | SkillDefinitionV1): SkillDefinitionInputV1 {
  if (!input || typeof input !== "object") throw new HarnessError("skill definition must be an object");
  if (input.version !== 1) throw new HarnessError("skill definition version must be 1");
  if (typeof input.id !== "string" || !identifier.test(input.id)) throw new HarnessError(`skill id is not a valid identifier: ${String(input.id)}`);
  if (typeof input.skillVersion !== "string" || !input.skillVersion.trim()) throw new HarnessError(`skill '${input.id}' skillVersion is required`);
  if (typeof input.instructions !== "string" || !input.instructions.trim()) throw new HarnessError(`skill '${input.id}' instructions must be a non-empty string`);
  const provenance = validateProvenance(input.id, input.provenance);
  return {
    version: 1,
    id: input.id,
    skillVersion: input.skillVersion.trim(),
    ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
    triggers: stringList(input.id, "triggers", input.triggers),
    domains: stringList(input.id, "domains", input.domains),
    ...(input.schemas ? { schemas: validateSchemas(input.id, input.schemas) } : {}),
    instructions: input.instructions,
    requiredCapabilities: stringList(input.id, "requiredCapabilities", input.requiredCapabilities),
    requiredTools: stringList(input.id, "requiredTools", input.requiredTools),
    knowledgeRefs: stringList(input.id, "knowledgeRefs", input.knowledgeRefs),
    provenance,
    ...(typeof input.contentHash === "string" && input.contentHash ? { contentHash: input.contentHash } : {}),
  };
}

function validateProvenance(skillId: string, value: SkillProvenanceV1): SkillProvenanceV1 {
  if (!value || value.source !== "local-pack") throw new HarnessError(`skill '${skillId}' provenance.source must be local-pack`);
  if (typeof value.packId !== "string" || !identifier.test(value.packId)) throw new HarnessError(`skill '${skillId}' provenance.packId is not a valid identifier`);
  return {
    source: "local-pack",
    packId: value.packId,
    ...(typeof value.digest === "string" && value.digest ? { digest: value.digest } : {}),
    ...(typeof value.publisher === "string" && value.publisher ? { publisher: value.publisher } : {}),
  };
}

function validateSchemas(skillId: string, value: SkillSchemasV1): SkillSchemasV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError(`skill '${skillId}' schemas must be an object`);
  return {
    ...(value.input !== undefined ? { input: value.input } : {}),
    ...(value.output !== undefined ? { output: value.output } : {}),
  };
}

function stringList(skillId: string, field: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new HarnessError(`skill '${skillId}' ${field} must be an array of strings`);
  }
  return value;
}
