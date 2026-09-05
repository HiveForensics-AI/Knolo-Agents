export { DependencyActivation, freezeAwareRegistry } from "./activation.js";
export { canonicalCbor } from "./cbor.js";
export {
  assertLockfilePin,
  assertLockfileRegistry,
  lockfilePackDigests,
  lockfilePin,
  normalizeRegistryUrl,
  parseLockfile,
  parseLockfileText,
  validateLockfile,
} from "./lockfile.js";
export type { KnoloLockPackV1, KnoloLockfileV1 } from "./lockfile.js";
export {
  computeHarnessDependencyRoot,
  dependencyPayload,
  mergePackDependencies,
  normalizePackDependency,
  packDependenciesFromLockfile,
  packDependencyFromManifest,
  sortPackDependencies,
} from "./root.js";
export { DEPENDENCY_ROOT_LABEL } from "./types.js";
export type { CanonicalCborCodec, HarnessDependencyRootV1, PackDependencyRoleV1, PackDependencyV1 } from "./types.js";
