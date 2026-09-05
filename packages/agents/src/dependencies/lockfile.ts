import { HarnessError } from "../harness/types.js";

export interface KnoloLockPackV1 {
  readonly version: string;
  readonly sha256: string;
  readonly stateRoot?: string;
  readonly license?: string;
}

/** Existing CLI lockfile. Do not invent a second format. */
export interface KnoloLockfileV1 {
  readonly registry?: string;
  readonly packs: Readonly<Record<string, KnoloLockPackV1>>;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function parseLockfile(value: unknown): KnoloLockfileV1 {
  if (typeof value === "string") return parseLockfileText(value);
  return validateLockfile(value);
}

export function parseLockfileText(text: string): KnoloLockfileV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HarnessError("knolo.lock.json must be valid JSON");
  }
  return validateLockfile(value);
}

export function validateLockfile(value: unknown): KnoloLockfileV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("knolo.lock.json must be a JSON object");
  const record = value as Record<string, unknown>;
  if (record.registry !== undefined && typeof record.registry !== "string") throw new HarnessError("knolo.lock.json registry must be a string");
  if (record.packs !== undefined && (!record.packs || typeof record.packs !== "object" || Array.isArray(record.packs))) {
    throw new HarnessError("knolo.lock.json packs must be an object");
  }
  const packs: Record<string, KnoloLockPackV1> = {};
  for (const [name, entry] of Object.entries((record.packs ?? {}) as Record<string, unknown>)) {
    packs[name] = validateLockPack(name, entry);
  }
  return {
    ...(typeof record.registry === "string" && record.registry ? { registry: record.registry } : {}),
    packs,
  };
}

export function normalizeRegistryUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function assertLockfileRegistry(lockfile: KnoloLockfileV1, registry: string, options: { force?: boolean } = {}): void {
  if (!lockfile.registry) return;
  if (normalizeRegistryUrl(lockfile.registry) === normalizeRegistryUrl(registry)) return;
  if (options.force) return;
  throw new HarnessError(`Lockfile registry is ${lockfile.registry}; refusing to mix registries without force`);
}

export function assertLockfilePin(lockfile: KnoloLockfileV1 | undefined, name: string, sha256: string, options: { force?: boolean } = {}): void {
  const existing = lockfile?.packs[name];
  if (!existing?.sha256) return;
  if (existing.sha256 === sha256) return;
  if (options.force) return;
  throw new HarnessError(`Lockfile already pins ${name} to a different digest; use force to replace it`);
}

export function lockfilePackDigests(lockfile: KnoloLockfileV1 | undefined): string[] {
  if (!lockfile) return [];
  return Object.values(lockfile.packs).map(entry => entry.sha256).sort();
}

export function lockfilePin(lockfile: KnoloLockfileV1, name: string): KnoloLockPackV1 | undefined {
  return lockfile.packs[name];
}

function validateLockPack(name: string, value: unknown): KnoloLockPackV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError(`knolo.lock.json pack '${name}' must be an object`);
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || !record.version) throw new HarnessError(`knolo.lock.json pack '${name}' is missing version`);
  if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) {
    throw new HarnessError(`knolo.lock.json pack '${name}' sha256 must be 64 lowercase hex characters`);
  }
  if (record.stateRoot !== undefined && typeof record.stateRoot !== "string") throw new HarnessError(`knolo.lock.json pack '${name}' stateRoot must be a string`);
  if (record.license !== undefined && typeof record.license !== "string") throw new HarnessError(`knolo.lock.json pack '${name}' license must be a string`);
  return {
    version: record.version,
    sha256: record.sha256,
    ...(typeof record.stateRoot === "string" ? { stateRoot: record.stateRoot } : {}),
    ...(typeof record.license === "string" ? { license: record.license } : {}),
  };
}
