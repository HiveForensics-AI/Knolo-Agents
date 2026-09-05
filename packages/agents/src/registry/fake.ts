import { assertLockfilePin, type KnoloLockfileV1 } from "../dependencies/lockfile.js";
import { sha256Bytes } from "../harness/hash.js";
import { HarnessError } from "../harness/types.js";
import { MemoryPackCache } from "./cache.js";
import { isPackManifest, parsePackSpec, validatePackManifest } from "./spec.js";
import type {
  PackBytesV1,
  PackCacheV1,
  PackManifestV1,
  PackPublishInputV1,
  PackRegistryCapabilityV1,
  PackSearchHitV1,
  PackSearchQueryV1,
  PackSpecV1,
} from "./types.js";

export interface MemoryPackRecord {
  readonly manifest: PackManifestV1;
  readonly bytes: Uint8Array;
  readonly description?: string;
}

export interface MemoryPackRegistryOptions {
  readonly origin?: string;
  readonly force?: boolean;
  readonly lockfile?: KnoloLockfileV1;
  readonly cache?: PackCacheV1;
  readonly packs?: readonly MemoryPackRecord[];
}

export class MemoryPackRegistry implements PackRegistryCapabilityV1 {
  readonly origin: string;
  readonly cache: PackCacheV1;
  private readonly force: boolean;
  private readonly lockfile?: KnoloLockfileV1;
  private readonly records = new Map<string, MemoryPackRecord>();
  private readonly latest = new Map<string, string>();

  constructor(options: MemoryPackRegistryOptions = {}) {
    this.origin = options.origin ?? "memory://packs";
    this.force = options.force === true;
    this.lockfile = options.lockfile;
    this.cache = options.cache ?? new MemoryPackCache();
    for (const pack of options.packs ?? []) this.add(pack);
  }

  add(record: MemoryPackRecord): this {
    const manifest = validatePackManifest(record.manifest);
    const stored = { manifest, bytes: new Uint8Array(record.bytes), description: record.description };
    this.records.set(key(manifest.name, manifest.version), stored);
    this.latest.set(manifest.name, manifest.version);
    this.cache.setManifest(manifest);
    this.cache.setBytes(manifest.sha256, stored.bytes);
    return this;
  }

  async search(query: PackSearchQueryV1 = {}): Promise<readonly PackSearchHitV1[]> {
    const needle = query.q?.toLowerCase().trim() ?? "";
    const hits: PackSearchHitV1[] = [];
    for (const [name, version] of [...this.latest.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const record = this.records.get(key(name, version));
      if (!record) continue;
      const { publisher, slug } = parsePackSpec(name);
      const hay = `${record.manifest.name} ${publisher} ${record.description ?? ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      if (query.license && record.manifest.license && !record.manifest.license.includes(query.license)) continue;
      if (record.manifest.yanked && !this.force) continue;
      hits.push({
        name: record.manifest.name,
        publisher,
        slug,
        version: record.manifest.version,
        sha256: record.manifest.sha256,
        ...(record.manifest.stateRoot ? { stateRoot: record.manifest.stateRoot } : {}),
        ...(record.manifest.license ? { license: record.manifest.license } : {}),
        ...(record.description ? { description: record.description } : {}),
        yanked: record.manifest.yanked,
      });
    }
    return hits;
  }

  async resolve(spec: string | PackSpecV1): Promise<PackManifestV1> {
    const parsed = parsePackSpec(spec);
    const version = parsed.version === "latest" ? this.latest.get(parsed.name) : parsed.version;
    if (!version) throw new HarnessError(`registry 404 not_found: pack version not found (${parsed.name}@${parsed.version})`);
    const record = this.records.get(key(parsed.name, version));
    if (!record) throw new HarnessError(`registry 404 not_found: pack version not found (${parsed.name}@${parsed.version})`);
    if (record.manifest.yanked && !this.force) {
      throw new HarnessError(`registry 410 yanked: Version yanked. (${record.manifest.name}@${record.manifest.version})`);
    }
    this.cache.setManifest(record.manifest);
    return record.manifest;
  }

  async pull(specOrManifest: string | PackSpecV1 | PackManifestV1): Promise<PackBytesV1> {
    const manifest = isPackManifest(specOrManifest) ? validatePackManifest(specOrManifest) : await this.resolve(specOrManifest);
    if (manifest.yanked && !this.force) throw new HarnessError(`registry 410 yanked: Version yanked. (${manifest.name}@${manifest.version})`);
    const record = this.records.get(key(manifest.name, manifest.version));
    if (!record) throw new HarnessError(`registry 404 not_found: pack version not found (${manifest.name}@${manifest.version})`);
    const digest = await sha256Bytes(record.bytes);
    if (digest !== manifest.sha256) throw new HarnessError(`registry digest_mismatch: expected ${manifest.sha256}, got ${digest}`);
    assertLockfilePin(this.lockfile, manifest.name, manifest.sha256, { force: this.force });
    this.cache.setBytes(manifest.sha256, record.bytes);
    this.cache.setManifest(manifest);
    return { manifest, bytes: new Uint8Array(record.bytes) };
  }

  async publish(input: PackPublishInputV1): Promise<PackManifestV1> {
    const digest = await sha256Bytes(input.bytes);
    const manifest = validatePackManifest({ ...input.manifest, sha256: input.manifest.sha256 || digest, yanked: false });
    if (digest !== manifest.sha256) throw new HarnessError(`registry digest_mismatch: expected ${manifest.sha256}, got ${digest}`);
    this.add({ manifest, bytes: input.bytes, description: input.description });
    return manifest;
  }

  async yank(spec: string | PackSpecV1): Promise<PackManifestV1> {
    const parsed = parsePackSpec(spec);
    const version = parsed.version === "latest" ? this.latest.get(parsed.name) : parsed.version;
    if (!version) throw new HarnessError(`registry 404 not_found: pack version not found (${parsed.name}@${parsed.version})`);
    const record = this.records.get(key(parsed.name, version));
    if (!record) throw new HarnessError(`registry 404 not_found: pack version not found (${parsed.name}@${parsed.version})`);
    const yanked = { ...record.manifest, yanked: true };
    this.records.set(key(parsed.name, version), { ...record, manifest: yanked });
    this.cache.setManifest(yanked);
    return yanked;
  }
}

export function memoryPackRegistry(options: MemoryPackRegistryOptions = {}): MemoryPackRegistry {
  return new MemoryPackRegistry(options);
}

function key(name: string, version: string): string {
  return `${name}@${version}`;
}
