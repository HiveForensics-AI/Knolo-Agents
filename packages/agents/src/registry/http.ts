import { assertLockfilePin, normalizeRegistryUrl, type KnoloLockfileV1 } from "../dependencies/lockfile.js";
import { sha256Bytes } from "../harness/hash.js";
import { HarnessError } from "../harness/types.js";
import { MemoryPackCache } from "./cache.js";
import { isPackManifest, parsePackSpec, validatePackManifest } from "./spec.js";
import type {
  PackBytesV1,
  PackCacheV1,
  PackManifestV1,
  PackRegistryCapabilityV1,
  PackSearchHitV1,
  PackSearchQueryV1,
  PackSpecV1,
} from "./types.js";

export interface HttpPackRegistryOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token?: string;
  readonly force?: boolean;
  readonly cache?: PackCacheV1;
  readonly lockfile?: KnoloLockfileV1;
  readonly offline?: boolean;
}

export class HttpPackRegistry implements PackRegistryCapabilityV1 {
  readonly origin: string;
  readonly cache: PackCacheV1;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly force: boolean;
  private readonly lockfile?: KnoloLockfileV1;
  private readonly offline: boolean;

  constructor(options: HttpPackRegistryOptions) {
    if (typeof options.fetch !== "function") throw new HarnessError("httpPackRegistry requires a host-provided fetch");
    this.origin = normalizeRegistryUrl(options.baseUrl);
    if (!this.origin) throw new HarnessError("httpPackRegistry requires a registry baseUrl");
    this.fetchImpl = options.fetch;
    this.token = options.token;
    this.force = options.force === true;
    this.cache = options.cache ?? new MemoryPackCache();
    this.lockfile = options.lockfile;
    this.offline = options.offline === true;
  }

  async search(query: PackSearchQueryV1 = {}): Promise<readonly PackSearchHitV1[]> {
    this.assertOnline("search");
    const url = new URL(`${this.origin}/api/v1/packs`);
    if (query.q) url.searchParams.set("q", query.q);
    if (query.format) url.searchParams.set("format", query.format);
    if (query.license) url.searchParams.set("license", query.license);
    if (query.agents) url.searchParams.set("agents", "true");
    if (query.official) url.searchParams.set("official", "true");
    if (query.verified) url.searchParams.set("verified", "true");
    if (query.sort) url.searchParams.set("sort", query.sort);
    const body = await this.requestJson(url.toString(), { method: "GET" });
    const packs = Array.isArray((body as { packs?: unknown }).packs) ? (body as { packs: unknown[] }).packs : [];
    return packs.map(item => asSearchHit(item)).sort((left, right) => left.name.localeCompare(right.name));
  }

  async resolve(spec: string | PackSpecV1): Promise<PackManifestV1> {
    const parsed = parsePackSpec(spec);
    if (this.offline) {
      const cached = this.cache.getManifest(parsed.name, parsed.version);
      if (cached) return denyYanked(cached, this.force);
      throw new HarnessError(`registry is offline; no cached manifest for ${parsed.name}@${parsed.version}`);
    }
    const url = `${this.origin}/api/v1/packs/${parsed.publisher}/${parsed.slug}/${parsed.version}`;
    const { status, body } = await this.request(url, { method: "GET" });
    if (status === 410) {
      const manifest = validatePackManifest(body, { name: parsed.name, version: parsed.version === "latest" ? undefined : parsed.version });
      this.cache.setManifest({ ...manifest, yanked: true });
      return denyYanked({ ...manifest, yanked: true }, this.force);
    }
    if (status === 404) throw new HarnessError(`registry 404 not_found: pack version not found (${parsed.name}@${parsed.version})`);
    if (status !== 200) throw registryHttpError(status, body);
    const manifest = validatePackManifest(body, { name: parsed.name, version: parsed.version === "latest" ? undefined : parsed.version });
    this.cache.setManifest(manifest);
    return denyYanked(manifest, this.force);
  }

  async pull(specOrManifest: string | PackSpecV1 | PackManifestV1): Promise<PackBytesV1> {
    const manifest = isPackManifest(specOrManifest) ? denyYanked(validatePackManifest(specOrManifest), this.force) : await this.resolve(specOrManifest);
    assertLockfilePin(this.lockfile, manifest.name, manifest.sha256, { force: this.force });
    const cached = this.cache.getBytes(manifest.sha256);
    if (cached) {
      await assertDigest(cached, manifest);
      return { manifest, bytes: cached };
    }
    this.assertOnline("pull");
    if (!manifest.url) throw new HarnessError(`artifact bytes are not stored yet (${manifest.name}@${manifest.version})`);
    const response = await this.fetchImpl(manifest.url, { method: "GET", headers: {} });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) throw new HarnessError(`registry blob ${response.status}: failed to download ${manifest.name}@${manifest.version}`);
    if (manifest.sizeBytes > 0 && bytes.byteLength !== manifest.sizeBytes) {
      throw new HarnessError(`registry size mismatch: expected ${manifest.sizeBytes} bytes, got ${bytes.byteLength}`);
    }
    await assertDigest(bytes, manifest);
    this.cache.setBytes(manifest.sha256, bytes);
    this.cache.setManifest(manifest);
    return { manifest, bytes };
  }

  async yank(spec: string | PackSpecV1): Promise<PackManifestV1> {
    this.assertOnline("yank");
    if (!this.token) throw new HarnessError("registry yank requires a host-provided token");
    const parsed = parsePackSpec(spec);
    const url = `${this.origin}/api/v1/packs/${parsed.publisher}/${parsed.slug}/${parsed.version}/yank`;
    const { status, body } = await this.request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
    });
    if (status !== 200) throw registryHttpError(status, body);
    const manifest = validatePackManifest((body as { manifest?: unknown }).manifest ?? body, { name: parsed.name });
    const yanked = { ...manifest, yanked: true };
    this.cache.setManifest(yanked);
    return yanked;
  }

  private assertOnline(action: string): void {
    if (this.offline) throw new HarnessError(`registry ${action} is unavailable offline`);
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    const { status, body } = await this.request(url, init);
    if (status !== 200) throw registryHttpError(status, body);
    return body;
  }

  private async request(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    const headers = { accept: "application/json", ...(init.headers as Record<string, string> | undefined) };
    const response = await this.fetchImpl(url, { ...init, headers });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }
}

export function httpPackRegistry(options: HttpPackRegistryOptions): HttpPackRegistry {
  return new HttpPackRegistry(options);
}

function denyYanked(manifest: PackManifestV1, force: boolean): PackManifestV1 {
  if (manifest.yanked && !force) throw new HarnessError(`registry 410 yanked: Version yanked. (${manifest.name}@${manifest.version})`);
  return manifest;
}

async function assertDigest(bytes: Uint8Array, manifest: PackManifestV1): Promise<void> {
  const digest = await sha256Bytes(bytes);
  if (digest !== manifest.sha256) throw new HarnessError(`registry digest_mismatch: expected ${manifest.sha256}, got ${digest}`);
}

function registryHttpError(status: number, body: unknown): HarnessError {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "error";
  const message = typeof record.error === "string" ? record.error : `HTTP ${status}`;
  return new HarnessError(`registry ${status} ${code}: ${message}`);
}

function asSearchHit(value: unknown): PackSearchHitV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("registry search returned an invalid pack");
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" && record.name.includes("/")
    ? record.name
    : typeof record.id === "string"
      ? record.id
      : `${record.publisher}/${record.slug}`;
  const parsed = parsePackSpec(name);
  if (typeof record.sha256 !== "string") throw new HarnessError("registry search hit is missing sha256");
  return {
    name: parsed.name,
    publisher: typeof record.publisher === "string" ? record.publisher : parsed.publisher,
    slug: typeof record.slug === "string" ? record.slug : parsed.slug,
    version: typeof record.version === "string" ? record.version : parsed.version,
    sha256: record.sha256,
    ...(typeof record.stateRoot === "string" ? { stateRoot: record.stateRoot } : {}),
    ...(typeof record.license === "string" ? { license: record.license } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    yanked: record.yanked === true,
  };
}
