import { lockfilePin, type KnoloLockfileV1 } from "../dependencies/lockfile.js";
import { HarnessError } from "../harness/types.js";
import { isPackManifest, parsePackSpec } from "./spec.js";
import type { PackBytesV1, PackCacheV1, PackManifestV1, PackRegistryCapabilityV1, PackSearchHitV1, PackSearchQueryV1, PackSpecV1 } from "./types.js";

export interface OfflinePackRegistryOptions {
  readonly cache?: PackCacheV1;
  readonly lockfile?: KnoloLockfileV1;
}

/** Pinned cache only. Remote Hub/Blob calls are not made. */
export function offlinePackRegistry(inner: PackRegistryCapabilityV1, options: OfflinePackRegistryOptions = {}): PackRegistryCapabilityV1 {
  const cache = options.cache ?? inner.cache;
  const lockfile = options.lockfile;
  const remote = isRemote(inner.origin);
  return {
    origin: inner.origin,
    cache,
    async search(query?: PackSearchQueryV1): Promise<readonly PackSearchHitV1[]> {
      if (!remote) return inner.search(query);
      throw new HarnessError("registry search is unavailable offline");
    },
    async resolve(spec: string | PackSpecV1): Promise<PackManifestV1> {
      if (!remote) return inner.resolve(spec);
      const parsed = parsePackSpec(spec);
      const cached = cache?.getManifest(parsed.name, parsed.version);
      if (cached) return cached;
      const pin = lockfile ? lockfilePin(lockfile, parsed.name) : undefined;
      if (pin && (parsed.version === "latest" || parsed.version === pin.version)) {
        return {
          name: parsed.name,
          version: pin.version,
          sha256: pin.sha256,
          ...(pin.stateRoot ? { stateRoot: pin.stateRoot } : {}),
          url: "",
          ...(pin.license ? { license: pin.license } : {}),
          sizeBytes: cache?.getBytes(pin.sha256)?.byteLength ?? 0,
          yanked: false,
        };
      }
      throw new HarnessError(`registry is offline; no cached manifest for ${parsed.name}@${parsed.version}`);
    },
    async pull(specOrManifest: string | PackSpecV1 | PackManifestV1): Promise<PackBytesV1> {
      if (!remote) return inner.pull(specOrManifest);
      const manifest = isPackManifest(specOrManifest) ? specOrManifest : await this.resolve(specOrManifest);
      const bytes = cache?.getBytes(manifest.sha256);
      if (!bytes) throw new HarnessError(`registry is offline; no cached bytes for ${manifest.name}@${manifest.version}`);
      return { manifest, bytes };
    },
    async publish() {
      throw new HarnessError("registry publish is unavailable offline");
    },
    async yank() {
      throw new HarnessError("registry yank is unavailable offline");
    },
  };
}

function isRemote(origin: string | undefined): boolean {
  return typeof origin === "string" && /^https?:\/\//i.test(origin);
}
