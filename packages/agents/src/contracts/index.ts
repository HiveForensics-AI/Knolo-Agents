export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export type ValueType = "Null" | "Bool" | "Number" | "String" | "Array" | "Object";
export interface StateSchemaV1 { readonly version: 1; readonly id: string; readonly paths: Readonly<Record<string, ValueType>>; readonly required: readonly string[] }
export interface ExecutionLimitsV1 { readonly max_steps: number; readonly max_tokens: number; readonly max_cost_micros: number; readonly timeout_ms: number }
export interface NodeDefinitionV1 { readonly id: string; readonly terminal: boolean; readonly reads: readonly string[]; readonly writes: readonly string[] }
export interface TransitionDefinitionV1 { readonly id: string; readonly from: string; readonly route: string; readonly to: string }
export interface CycleDefinitionV1 { readonly nodes: readonly string[]; readonly max_iterations: number }
export interface GraphDefinitionV1 { readonly version: 1; readonly id: string; readonly state_schema: string; readonly entry: string; readonly nodes: readonly NodeDefinitionV1[]; readonly transitions: readonly TransitionDefinitionV1[]; readonly cycles: readonly CycleDefinitionV1[]; readonly limits: ExecutionLimitsV1 }

export interface ProvenanceV1 { readonly execution_id: string; readonly node_id: string; readonly event_sequence: number }
export interface StateSnapshot<S = JsonValue> { readonly schema_id: string; readonly revision: number; readonly value: S; readonly provenance: ProvenanceV1 | null }
export type PatchOperation = { readonly Set: JsonValue } | "Remove";
export interface StatePatch { readonly base_revision: number; readonly operations: Readonly<Record<string, PatchOperation>> }

export type Routing = { readonly type: "continue" } | { readonly type: "route"; readonly route: string } | { readonly type: "suspend"; readonly reason: string } | { readonly type: "terminate"; readonly result: JsonValue } | { readonly type: "fail"; readonly error: string; readonly retryable: boolean };
export type NodeOutcome<S> =
  | { readonly type: "continue"; readonly patch?: StateUpdate<S> }
  | { readonly type: "route"; readonly route: string; readonly patch?: StateUpdate<S> }
  | { readonly type: "suspend"; readonly reason: string; readonly patch?: StateUpdate<S> }
  | { readonly type: "terminate"; readonly result: JsonValue; readonly patch?: StateUpdate<S> }
  | { readonly type: "fail"; readonly error: string; readonly retryable: boolean };
export type StateUpdate<S> = Partial<S> | ((state: Readonly<S>) => Partial<S>);
export interface NodeExecution<S> { readonly outcome: NodeOutcome<S>; readonly tokens?: number; readonly cost_micros?: number }

export type EventKindV1 =
  | { readonly type: "execution_started" }
  | { readonly type: "node_started"; readonly attempt: number }
  | { readonly type: "state_patched"; readonly revision: number }
  | { readonly type: "routed"; readonly route: string; readonly to: string }
  | { readonly type: "retrying"; readonly attempt: number }
  | { readonly type: "suspended"; readonly reason: string }
  | { readonly type: "terminated" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "cancelled" }
  | { readonly type: "checkpointed" }
  | { readonly type: "tool_call"; readonly call: ToolCallV1 }
  | { readonly type: "tool_result"; readonly result: ToolResultV1 };
export interface ExecutionEventV1 { readonly version: 1; readonly sequence: number; readonly execution_id: string; readonly node_id: string | null; readonly timestamp_ms: number; readonly kind: EventKindV1 }
export type ExecutionStatus<R = JsonValue> = { readonly type: "suspended"; readonly reason: string } | { readonly type: "terminated"; readonly result: R } | { readonly type: "failed"; readonly error: string } | { readonly type: "cancelled" };
export interface ExecutionReport<S, R = JsonValue> {
  readonly status: ExecutionStatus<R>;
  readonly state: StateSnapshot<S>;
  readonly events: readonly ExecutionEventV1[];
  readonly steps: number;
  readonly tokens: number;
  readonly cost_micros: number;
  /** Per-revision snapshots from the portable engine. Absent on hosts that only emit events. */
  readonly snapshots?: readonly StateSnapshot<S>[];
}
export interface Suspension<I = JsonValue> { readonly version: 1; readonly execution_id: string; readonly reason: string; readonly checkpoint: CheckpointV1; readonly input?: I }
export interface CheckpointV1 { readonly version: 1; readonly execution_id: string; readonly graph_hash: string; readonly pack_hash: string; readonly policy_hash: string; readonly node_implementation_hash: string; readonly contract_hash: string; readonly state: StateSnapshot; readonly pending_node: string; readonly event_cursor: number; readonly steps: number; readonly tokens: number; readonly cost_micros: number }
export type Failure = { readonly type: "definition"; readonly message: string } | { readonly type: "unsupported"; readonly engine: EngineName; readonly capability: string } | { readonly type: "execution"; readonly message: string } | { readonly type: "cancelled"; readonly message: string };
export type EngineName = "typescript" | "wasm";
export type Capability = "state" | "routing" | "suspension" | "tools" | "retrieval" | "durable_checkpoints";
export type EngineCapability<E extends EngineName> = E extends "typescript" | "wasm" ? "state" | "routing" | "suspension" : never;
/** Resolves to `never` when a capability list cannot run on the selected engine. */
export type AssertEngineCapabilities<E extends EngineName, C extends readonly Capability[]> = Exclude<C[number], EngineCapability<E>> extends never ? C : never;
export interface WasmDispatchRequest<S = JsonValue> { readonly node_id: string; readonly state: S; readonly attempt: number }
export interface WasmNodeExecution<S = JsonValue> { readonly outcome: NodeOutcome<S> & { readonly patch?: Partial<S> }; readonly tokens?: number; readonly cost_micros?: number }
export type EngineCommand<S = JsonValue, I = JsonValue> =
  | { readonly type: "run"; readonly execution_id: string; readonly state: S }
  | { readonly type: "resume"; readonly checkpoint: CheckpointV1; readonly input: I }
  | { readonly type: "continue"; readonly session: JsonValue; readonly execution: WasmNodeExecution<S> }
  | { readonly type: "replay"; readonly events: readonly ExecutionEventV1[] }
  | { readonly type: "inspect" };
export type EngineResponse<S = JsonValue> =
  | { readonly type: "event"; readonly event: ExecutionEventV1 }
  | { readonly type: "dispatch"; readonly request: WasmDispatchRequest<S>; readonly session: JsonValue }
  | { readonly type: "report"; readonly report: ExecutionReport<S> }
  | { readonly type: "inspection"; readonly inspection: AgentInspection }
  | { readonly type: "error"; readonly failure: Failure };
export interface AgentInspection { readonly engine: EngineName; readonly graph: GraphDefinitionV1; readonly capabilities: readonly string[]; readonly limitations: readonly string[] }
export interface ToolCallV1 { readonly version: 1; readonly call_id: string; readonly tool_id: string; readonly arguments: JsonValue }
export interface ToolResultV1 { readonly version: 1; readonly call_id: string; readonly tool_id: string; readonly value: JsonValue; readonly usage: ResourceUsageV1 }
export interface ResourceUsageV1 { readonly calls: number; readonly units: number; readonly duration_ms: number }
export interface RetrievalEvidenceV1 { readonly content: JsonValue; readonly score_micros: number; readonly provenance: { readonly source_id: string; readonly locator: string; readonly content_hash: string } }
export interface RetrievalResultV1 { readonly version: 1; readonly evidence: readonly RetrievalEvidenceV1[] }
