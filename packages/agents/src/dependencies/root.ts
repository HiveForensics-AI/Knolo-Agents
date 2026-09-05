import { sha256Bytes } from "../harness/hash.js";
import { HarnessError } from "../harness/types.js";
import type { PackManifestV1 } from "../registry/types.js";
import { canonicalCbor } from "./cbor.js";
import type { KnoloLockfileV1 } from "./lockfile.js";
import { DEPENDENCY_ROOT_LABEL, type CanonicalCborCodec, type HarnessDependencyRootV1, type PackDependencyRoleV1, type PackDependencyV1 } from "./types.js";

const SHA256 = /^[0-9a-f]{64}$/;
const ROLES: readonly PackDependencyRoleV1[] = ["knowledge", "skill", "policy", "evaluation", "workflow"];

export function sortPackDependencies(dependencies: readonly PackDependencyV1[]): PackDependencyV1[] {
  return [...dependencies]
    .map(normalizePackDependency)
    .sort((left, right) => left.name.localeCompare(right.name) || left.role.localeCompare(right.role) || left.sha256.localeCompare(right.sha256) || left.version.localeCompare(right.version));
}

export function mergePackDependencies(base: readonly PackDependencyV1[], extra: readonly PackDependencyV1[]): PackDependencyV1[] {
  const map = new Map<string, PackDependencyV1>();
  for (const item of [...base, ...extra].map(normalizePackDependency)) map.set(`${item.role}:${item.name}`, item);
  return sortPackDependencies([...map.values()]);
}

export function normalizePackDependency(value: PackDependencyV1): PackDependencyV1 {
  if (!value || typeof value !== "object") throw new HarnessError("pack dependency must be an object");
  if (typeof value.name !== "string" || !value.name.trim()) throw new HarnessError("pack dependency name is required");
  if (typeof value.version !== "string" || !value.version.trim()) throw new HarnessError(`pack dependency '${value.name}' is missing version`);
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new HarnessError(`pack dependency '${value.name}' sha256 must be 64 lowercase hex characters`);
  }
  if (!ROLES.includes(value.role)) throw new HarnessError(`pack dependency '${value.name}' has an unknown role`);
  if (value.stateRoot !== undefined && typeof value.stateRoot !== "string") {
    throw new HarnessError(`pack dependency '${value.name}' stateRoot must be a string`);
  }
  return {
    name: value.name,
    version: value.version,
    sha256: value.sha256,
    ...(value.stateRoot ? { stateRoot: value.stateRoot } : {}),
    role: value.role,
  };
}

export function packDependencyFromManifest(manifest: PackManifestV1, role: PackDependencyRoleV1 = "knowledge"): PackDependencyV1 {
  return normalizePackDependency({
    name: manifest.name,
    version: manifest.version,
    sha256: manifest.sha256,
    ...(manifest.stateRoot ? { stateRoot: manifest.stateRoot } : {}),
    role,
  });
}

export function packDependenciesFromLockfile(lockfile: KnoloLockfileV1 | undefined, role: PackDependencyRoleV1 = "knowledge"): PackDependencyV1[] {
  if (!lockfile) return [];
  return sortPackDependencies(
    Object.entries(lockfile.packs).map(([name, pin]) => ({
      name,
      version: pin.version,
      sha256: pin.sha256,
      ...(pin.stateRoot ? { stateRoot: pin.stateRoot } : {}),
      role,
    })),
  );
}

export function dependencyPayload(dependencies: readonly PackDependencyV1[]): unknown {
  return sortPackDependencies(dependencies).map(item => ({
    name: item.name,
    role: item.role,
    sha256: item.sha256,
    ...(item.stateRoot ? { stateRoot: item.stateRoot } : {}),
    version: item.version,
  }));
}

export async function computeHarnessDependencyRoot(
  dependencies: readonly PackDependencyV1[] = [],
  codec?: CanonicalCborCodec,
): Promise<HarnessDependencyRootV1> {
  const sorted = sortPackDependencies(dependencies);
  const payload = dependencyPayload(sorted);
  const cbor = codec?.canonicalCbor(payload) ?? canonicalCbor(payload);
  const label = new TextEncoder().encode(DEPENDENCY_ROOT_LABEL);
  const framed = new Uint8Array(label.length + 1 + cbor.length);
  framed.set(label, 0);
  framed[label.length] = 0;
  framed.set(cbor, label.length + 1);
  return {
    version: 1,
    algorithm: DEPENDENCY_ROOT_LABEL,
    dependencies: sorted,
    root: `${DEPENDENCY_ROOT_LABEL}:${await sha256Bytes(framed)}`,
  };
}
