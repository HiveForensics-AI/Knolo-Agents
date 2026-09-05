import { HarnessError } from "../harness/types.js";
import type { SkillDefinitionInputV1, SkillDefinitionV1 } from "../skills/types.js";
import { capabilityMetadataFromPack } from "./pack.js";
import type { CapabilityMetadataV1 } from "./types.js";

export interface IndexedSkillV1 {
  readonly skill: SkillDefinitionInputV1 | SkillDefinitionV1;
  readonly packId: string;
}

/** Local index of capability metadata carried by existing `.knolo` artifacts. */
export class CapabilityIndex {
  private readonly packs = new Map<string, CapabilityMetadataV1>();
  private readonly bySkillId = new Map<string, IndexedSkillV1>();

  static empty(): CapabilityIndex {
    return new CapabilityIndex();
  }

  static from(entries: readonly CapabilityMetadataV1[]): CapabilityIndex {
    const index = new CapabilityIndex();
    for (const entry of entries) index.add(entry);
    return index;
  }

  static fromPacks(packs: readonly unknown[]): CapabilityIndex {
    return CapabilityIndex.from(packs.map(pack => capabilityMetadataFromPack(pack)));
  }

  static fromDefinitions(definitions: readonly SkillDefinitionInputV1[], packId = "local"): CapabilityIndex {
    const index = new CapabilityIndex();
    index.add({
      version: 1,
      packId,
      role: "skill",
      capabilities: [],
      tools: [],
      namespaces: [],
      skills: definitions,
    });
    return index;
  }

  add(metadata: CapabilityMetadataV1): this {
    if (this.packs.has(metadata.packId)) throw new HarnessError(`duplicate pack in capability index: ${metadata.packId}`);
    this.packs.set(metadata.packId, metadata);
    for (const skill of metadata.skills) {
      if (this.bySkillId.has(skill.id)) throw new HarnessError(`duplicate skill in capability index: ${skill.id}`);
      this.bySkillId.set(skill.id, { skill, packId: metadata.packId });
    }
    return this;
  }

  tryAdd(metadata: CapabilityMetadataV1): boolean {
    if (this.packs.has(metadata.packId)) return false;
    if (metadata.skills.some(skill => this.bySkillId.has(skill.id))) return false;
    this.add(metadata);
    return true;
  }

  hasPack(packId: string): boolean {
    return this.packs.has(packId);
  }

  addPacks(packs: readonly unknown[]): this {
    for (const pack of packs) this.add(capabilityMetadataFromPack(pack));
    return this;
  }

  addDefinitions(definitions: readonly SkillDefinitionInputV1[], packId = "local"): this {
    return this.add({
      version: 1,
      packId,
      role: "skill",
      capabilities: [],
      tools: [],
      namespaces: [],
      skills: definitions,
    });
  }

  metadata(): CapabilityMetadataV1[] {
    return [...this.packs.values()].sort((left, right) => left.packId.localeCompare(right.packId));
  }

  skills(): IndexedSkillV1[] {
    return [...this.bySkillId.values()].sort((left, right) => left.skill.id.localeCompare(right.skill.id));
  }

  skill(id: string): IndexedSkillV1 | undefined {
    return this.bySkillId.get(id);
  }

  capabilities(): string[] {
    return uniqueFrom(this.metadata().flatMap(item => item.capabilities));
  }

  tools(): string[] {
    return uniqueFrom(this.metadata().flatMap(item => item.tools));
  }
}

function uniqueFrom(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
