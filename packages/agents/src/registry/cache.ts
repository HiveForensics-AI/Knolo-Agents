import type { PackCacheV1, PackManifestV1 } from "./types.js";

export class MemoryPackCache implements PackCacheV1 {
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly manifests = new Map<string, PackManifestV1>();

  getBytes(sha256: string): Uint8Array | undefined {
    const stored = this.bytes.get(sha256);
    return stored ? new Uint8Array(stored) : undefined;
  }

  setBytes(sha256: string, bytes: Uint8Array): void {
    this.bytes.set(sha256, new Uint8Array(bytes));
  }

  getManifest(name: string, version = "latest"): PackManifestV1 | undefined {
    if (version === "latest") return this.manifests.get(`${name}@latest`) ?? this.manifests.get(name);
    return this.manifests.get(`${name}@${version}`);
  }

  setManifest(manifest: PackManifestV1): void {
    this.manifests.set(`${manifest.name}@${manifest.version}`, manifest);
    this.manifests.set(`${manifest.name}@latest`, manifest);
    this.manifests.set(manifest.name, manifest);
  }
}
