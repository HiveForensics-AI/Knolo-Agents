export type PackDependencyRoleV1 = "knowledge" | "skill" | "policy" | "evaluation" | "workflow";

export interface PackDependencyV1 {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
  readonly stateRoot?: string;
  readonly role: PackDependencyRoleV1;
}

export interface HarnessDependencyRootV1 {
  readonly version: 1;
  readonly algorithm: "knolo.harness.dependencies.v1";
  readonly dependencies: readonly PackDependencyV1[];
  readonly root: string;
}

export interface CanonicalCborCodec {
  canonicalCbor(value: unknown): Uint8Array;
}

export const DEPENDENCY_ROOT_LABEL = "knolo.harness.dependencies.v1";
