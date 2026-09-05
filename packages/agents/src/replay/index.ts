import { DefinitionError } from "../builder/index.js";
import type { ExecutionEventV1, ExecutionReport, StateSnapshot } from "../contracts/index.js";

export type ReplayModeV1 = "verify_only" | "mocked_effects" | "live_effects";
export interface ArtifactHashesV1 {
  readonly graph: string;
  readonly pack: string;
  readonly policy: string;
  readonly nodeImplementation: string;
  readonly contract: string;
}
export interface ReplayRequestV1 {
  readonly version: 1;
  readonly mode: ReplayModeV1;
  readonly artifacts: ArtifactHashesV1;
  readonly liveEffectAuthorization?: string;
}

/** Ordered events plus per-revision state snapshots for portable replay. */
export interface ReplayTraceV1<S = unknown> {
  readonly version: 1;
  readonly events: readonly ExecutionEventV1[];
  readonly snapshots?: readonly StateSnapshot<S>[];
}

export const validateReplay = (request: ReplayRequestV1, actual: ArtifactHashesV1): void => {
  for (const key of Object.keys(actual) as (keyof ArtifactHashesV1)[]) if (request.artifacts[key] !== actual[key]) throw new Error(`incompatible ${key} hash`);
  if (request.mode === "live_effects" && !request.liveEffectAuthorization) throw new Error("live-effect replay requires explicit authorization");
};

export function isReplayTrace(value: unknown): value is ReplayTraceV1 {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as ReplayTraceV1).version === 1 && Array.isArray((value as ReplayTraceV1).events);
}

export function recordReplayTrace<S>(report: ExecutionReport<S>): ReplayTraceV1<S> {
  return {
    version: 1,
    events: report.events,
    snapshots: report.snapshots ?? [report.state],
  };
}

export function validateReplayEvents(events: readonly ExecutionEventV1[]): void {
  let previous = 0;
  let executionId: string | undefined;
  for (const event of events) {
    if (event.version !== 1 || event.sequence !== previous + 1) throw new DefinitionError("replay events must be version 1 and contiguous");
    if (executionId && event.execution_id !== executionId) throw new DefinitionError("replay events must belong to one execution");
    executionId = event.execution_id;
    previous = event.sequence;
  }
}

export function assertReplayMatch(actual: ExecutionReport<unknown, unknown>, expected: ReplayTraceV1<unknown>): void {
  if (JSON.stringify(controlTrace(actual.events)) !== JSON.stringify(controlTrace(expected.events))) {
    throw new DefinitionError("deterministic replay diverged from recorded control-plane events");
  }
  const expectedResult = expected.events.find(event => event.kind.type === "terminated");
  if (actual.status.type !== (expectedResult ? "terminated" : actual.status.type)) {
    throw new DefinitionError("deterministic replay diverged from recorded control-plane events");
  }
  if (expected.snapshots) {
    const actualSnapshots = actual.snapshots ?? [];
    if (JSON.stringify(snapshotTrace(actualSnapshots)) !== JSON.stringify(snapshotTrace(expected.snapshots))) {
      throw new DefinitionError("deterministic replay diverged from recorded state snapshots");
    }
  }
}

function controlTrace(events: readonly ExecutionEventV1[]): unknown[] {
  return events.map(({ timestamp_ms: _timestamp, ...event }) => event);
}

function snapshotTrace(snapshots: readonly StateSnapshot<unknown>[]): unknown[] {
  return snapshots.map(snapshot => ({
    schema_id: snapshot.schema_id,
    revision: snapshot.revision,
    value: canonicalize(snapshot.value),
    provenance: snapshot.provenance,
  }));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]));
}
