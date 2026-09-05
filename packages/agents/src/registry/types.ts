export interface PackSpecV1 {
  readonly publisher: string;
  readonly slug: string;
  readonly version: string;
  readonly name: string;
}

export interface PackManifestV1 {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
  readonly stateRoot?: string;
  readonly url: string;
  readonly license?: string;
  readonly sizeBytes: number;
  readonly yanked: boolean;
  readonly format?: "V4" | "V5";
}

export interface PackSearchQueryV1 {
  readonly q?: string;
  readonly format?: "V4" | "V5";
  readonly license?: string;
  readonly agents?: boolean;
  readonly official?: boolean;
  readonly verified?: boolean;
  readonly sort?: "trending" | "new" | "stars" | "name";
}

export interface PackSearchHitV1 {
  readonly name: string;
  readonly publisher: string;
  readonly slug: string;
  readonly version: string;
  readonly sha256: string;
  readonly stateRoot?: string;
  readonly license?: string;
  readonly description?: string;
  readonly yanked?: boolean;
}

export interface PackBytesV1 {
  readonly manifest: PackManifestV1;
  readonly bytes: Uint8Array;
}

export interface PackPublishInputV1 {
  readonly manifest: PackManifestV1;
  readonly bytes: Uint8Array;
  readonly description?: string;
}

export interface PackCacheV1 {
  getBytes(sha256: string): Uint8Array | undefined;
  setBytes(sha256: string, bytes: Uint8Array): void;
  getManifest(name: string, version?: string): PackManifestV1 | undefined;
  setManifest(manifest: PackManifestV1): void;
}

export interface PackRegistryCapabilityV1 {
  readonly origin?: string;
  readonly cache?: PackCacheV1;
  search(query?: PackSearchQueryV1): Promise<readonly PackSearchHitV1[]>;
  resolve(spec: string | PackSpecV1): Promise<PackManifestV1>;
  pull(specOrManifest: string | PackSpecV1 | PackManifestV1): Promise<PackBytesV1>;
  publish?(input: PackPublishInputV1): Promise<PackManifestV1>;
  yank?(spec: string | PackSpecV1): Promise<PackManifestV1>;
}

export function isPackRegistry(value: unknown): value is PackRegistryCapabilityV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as PackRegistryCapabilityV1;
  return typeof record.search === "function" && typeof record.resolve === "function" && typeof record.pull === "function";
}
