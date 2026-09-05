import { HarnessError } from "../harness/types.js";
import type { PackManifestV1, PackSpecV1 } from "./types.js";

const PACK_SPEC = /^(?<publisher>[a-z0-9-]+)\/(?<slug>[a-z0-9-]+)(?:@(?<version>[^@]+))?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parsePackSpec(value: string | PackSpecV1): PackSpecV1 {
  if (typeof value !== "string") {
    if (!value?.publisher || !value.slug) throw new HarnessError("pack spec must be publisher/slug[@version]");
    return {
      publisher: value.publisher,
      slug: value.slug,
      version: value.version || "latest",
      name: value.name || `${value.publisher}/${value.slug}`,
    };
  }
  const match = PACK_SPEC.exec(value.trim());
  if (!match?.groups) throw new HarnessError(`Invalid pack spec: ${value}. Expected publisher/slug[@version].`);
  const publisher = match.groups.publisher;
  const slug = match.groups.slug;
  return { publisher, slug, version: match.groups.version || "latest", name: `${publisher}/${slug}` };
}

export function isPackManifest(value: unknown): value is PackManifestV1 {
  return Boolean(value && typeof value === "object" && typeof (value as PackManifestV1).sha256 === "string" && typeof (value as PackManifestV1).url === "string");
}

export function validatePackManifest(value: unknown, expected?: { name?: string; version?: string }): PackManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("Registry returned an invalid pack manifest");
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name) throw new HarnessError("Registry manifest is missing name");
  if (expected?.name && record.name !== expected.name) throw new HarnessError(`Registry manifest name mismatch: expected ${expected.name}, got ${record.name}`);
  if (typeof record.version !== "string" || !record.version) throw new HarnessError("Registry manifest is missing version");
  if (expected?.version && expected.version !== "latest" && record.version !== expected.version) {
    throw new HarnessError(`Registry manifest version mismatch: expected ${expected.version}, got ${record.version}`);
  }
  if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) {
    throw new HarnessError("Registry manifest sha256 must be 64 lowercase hexadecimal characters");
  }
  if (typeof record.url !== "string") throw new HarnessError("Registry manifest is missing url");
  if (!Number.isSafeInteger(record.sizeBytes) || (record.sizeBytes as number) < 0) {
    throw new HarnessError("Registry manifest sizeBytes must be a non-negative integer");
  }
  if (record.stateRoot !== undefined && typeof record.stateRoot !== "string") throw new HarnessError("Registry manifest stateRoot must be a string when present");
  if (record.license !== undefined && typeof record.license !== "string") throw new HarnessError("Registry manifest license must be a string when present");
  if (record.yanked !== undefined && typeof record.yanked !== "boolean") throw new HarnessError("Registry manifest yanked must be a boolean when present");
  if (record.format !== undefined && record.format !== "V4" && record.format !== "V5") throw new HarnessError("Registry manifest format must be V4 or V5 when present");
  return {
    name: record.name,
    version: record.version,
    sha256: record.sha256,
    ...(typeof record.stateRoot === "string" ? { stateRoot: record.stateRoot } : {}),
    url: record.url,
    ...(typeof record.license === "string" ? { license: record.license } : {}),
    sizeBytes: record.sizeBytes as number,
    yanked: record.yanked === true,
    ...(record.format === "V4" || record.format === "V5" ? { format: record.format } : {}),
  };
}
