import { HarnessError } from "../harness/types.js";
import type { PackBytesV1, PackManifestV1, PackRegistryCapabilityV1, PackSearchQueryV1, PackSpecV1 } from "../registry/types.js";
import { computeHarnessDependencyRoot, mergePackDependencies, normalizePackDependency, packDependencyFromManifest } from "./root.js";
import type { CanonicalCborCodec, HarnessDependencyRootV1, PackDependencyRoleV1, PackDependencyV1 } from "./types.js";

export class DependencyActivation {
  private active: PackDependencyV1[] = [];
  private stagedList: PackDependencyV1[] = [];
  private frozenRoot: HarnessDependencyRootV1 | null = null;

  constructor(private readonly codec?: CanonicalCborCodec) {}

  get frozen(): boolean {
    return this.frozenRoot !== null;
  }

  get root(): HarnessDependencyRootV1 | null {
    return this.frozenRoot;
  }

  snapshot(): { active: readonly PackDependencyV1[]; staged: readonly PackDependencyV1[]; frozen: HarnessDependencyRootV1 | null } {
    return { active: this.active, staged: this.stagedList, frozen: this.frozenRoot };
  }

  add(dependency: PackDependencyV1): void {
    if (this.frozenRoot) throw new HarnessError("dependency set is frozen for this run; stage packs for the next run");
    this.active = mergePackDependencies(this.active, [normalizePackDependency(dependency)]);
  }

  replaceActive(dependencies: readonly PackDependencyV1[]): void {
    if (this.frozenRoot) throw new HarnessError("dependency set is frozen for this run; stage packs for the next run");
    this.active = mergePackDependencies([], dependencies);
  }

  stage(dependency: PackDependencyV1): void {
    this.stagedList = mergePackDependencies(this.stagedList, [normalizePackDependency(dependency)]);
  }

  activateStaged(): void {
    this.frozenRoot = null;
    this.active = mergePackDependencies(this.active, this.stagedList);
    this.stagedList = [];
  }

  async freeze(): Promise<HarnessDependencyRootV1> {
    if (this.frozenRoot) return this.frozenRoot;
    this.frozenRoot = await computeHarnessDependencyRoot(this.active, this.codec);
    this.active = this.frozenRoot.dependencies.slice();
    return this.frozenRoot;
  }
}

export function freezeAwareRegistry(
  registry: PackRegistryCapabilityV1,
  activation: DependencyActivation,
  role: PackDependencyRoleV1 = "knowledge",
): PackRegistryCapabilityV1 {
  return {
    origin: registry.origin,
    cache: registry.cache,
    search: (query?: PackSearchQueryV1) => registry.search(query),
    resolve: (spec: string | PackSpecV1) => registry.resolve(spec),
    pull: async (specOrManifest: string | PackSpecV1 | PackManifestV1): Promise<PackBytesV1> => {
      const result = await registry.pull(specOrManifest);
      const dependency = packDependencyFromManifest(result.manifest, role);
      if (activation.frozen) activation.stage(dependency);
      else activation.add(dependency);
      return result;
    },
    ...(registry.publish ? { publish: registry.publish.bind(registry) } : {}),
    ...(registry.yank ? { yank: registry.yank.bind(registry) } : {}),
  };
}
