import type { ExecutionEventV1, StateSnapshotRecordV1 } from "../contracts/index.js";

export type ReplayModeV1 = "verify_only" | "mocked_effects" | "live_effects";
export interface ArtifactHashesV1 { readonly graph: string; readonly pack: string; readonly policy: string; readonly nodeImplementation: string; readonly contract: string }
export interface ReplayRequestV1 { readonly version: 1; readonly mode: ReplayModeV1; readonly artifacts: ArtifactHashesV1; readonly liveEffectAuthorization?: string }
export interface ReplayTraceV1<S = unknown> { readonly events: readonly ExecutionEventV1[]; readonly state_snapshots: readonly StateSnapshotRecordV1<S>[] }
export const validateReplay = (request: ReplayRequestV1, actual: ArtifactHashesV1): void => {
  for (const key of Object.keys(actual) as (keyof ArtifactHashesV1)[]) if (request.artifacts[key] !== actual[key]) throw new Error(`incompatible ${key} hash`);
  if (request.mode === "live_effects" && !request.liveEffectAuthorization) throw new Error("live-effect replay requires explicit authorization");
};

export const assertStateSnapshots = <S>(expected: readonly StateSnapshotRecordV1<S>[], actual: readonly StateSnapshotRecordV1<S>[]): void => {
  if (expected.length !== actual.length) throw new Error("state snapshot replay diverged: snapshot count differs");
  for (let index = 0; index < expected.length; index++) {
    const left = expected[index]!;
    const right = actual[index]!;
    if (left.version !== right.version || left.revision !== right.revision || left.event_sequence !== right.event_sequence || JSON.stringify(left.state) !== JSON.stringify(right.state)) {
      throw new Error(`state snapshot replay diverged at revision ${left.revision}`);
    }
  }
};
