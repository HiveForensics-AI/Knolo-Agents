/**
 * TypeScript client types and helpers for the Knolo ICP agent runtime canister.
 *
 * This module is **engine-agnostic**: it does not hard-depend on `@dfinity/agent`.
 * Pass an actor (or thin call adapter) created with `@dfinity/agent` + the
 * canister IDL from `examples/icp-agent-canister` or your dfx declarations.
 *
 * Optional peers for live calls:
 *   - `@dfinity/agent`
 *   - `@dfinity/candid`
 *   - `@dfinity/principal`
 */

/** Candid-aligned health / status DTOs (Phase 3 surface). */
export interface HealthDto {
  ok: boolean;
  message: string;
}

export interface InspectionDto {
  ok: boolean;
  engine: string;
  graph_loaded: boolean;
  graph_id: string | null | [];
  graph_hash: string | null | [];
  implementation_id: string | null | [];
  execution_count: bigint | number;
  capabilities: string[];
  limitations: string[];
  message: string;
  schema_version: number;
  handoff_count: bigint | number;
}

export interface StatusDto {
  kind: string;
  detail: string;
}

export interface RunReportDto {
  ok: boolean;
  execution_id: string;
  status: StatusDto;
  steps: bigint | number;
  tokens: bigint | number;
  cost_micros: bigint | number;
  state_json: string;
  event_count: bigint | number;
  message: string;
}

export interface EventsDto {
  ok: boolean;
  execution_id: string;
  events_json: string;
  message: string;
}

export interface CheckpointDto {
  ok: boolean;
  execution_id: string;
  present: boolean;
  checkpoint_json: string;
  message: string;
}

export interface BudgetDto {
  ok: boolean;
  tool_calls: bigint | number;
  tool_units: bigint | number;
  llm_calls: bigint | number;
  retrieval_calls: bigint | number;
  effect_rounds: bigint | number;
  knolo_steps: bigint | number;
  knolo_tokens: bigint | number;
  knolo_cost_micros: bigint | number;
  cycles_spent_observed: bigint | number;
  last_cycles_balance: bigint | number | null | [];
  message: string;
}

export interface LimitsDto {
  ok: boolean;
  max_concurrent_executions: number;
  max_events_per_execution: number;
  max_execution_id_len: number;
  max_state_bytes: number;
  max_handoff_bytes: number;
  require_controller_for_runs: boolean;
  allowed_callers: string[];
  min_cycles_reserve: bigint | number;
  message: string;
}

export interface StoreStatsDto {
  ok: boolean;
  schema_version: number;
  execution_count: bigint | number;
  checkpoint_count: bigint | number;
  event_entry_count: bigint | number;
  handoff_count: bigint | number;
  has_definition: boolean;
  message: string;
}

export interface ExecutionListDto {
  ok: boolean;
  execution_ids: string[];
  message: string;
}

export interface HandoffDto {
  ok: boolean;
  handoff_id: string;
  execution_id: string;
  destination: string;
  status: string;
  message: string;
}

/** Minimal actor surface matching `agent_runtime.did` (Phase 3). */
export interface AgentRuntimeActor {
  health: () => Promise<HealthDto>;
  inspect: () => Promise<InspectionDto>;
  get_budget: () => Promise<BudgetDto>;
  get_limits: () => Promise<LimitsDto>;
  get_store_stats: () => Promise<StoreStatsDto>;
  list_executions: () => Promise<ExecutionListDto>;
  load_definition: (json: string) => Promise<HealthDto>;
  clear_definition: () => Promise<HealthDto>;
  set_limits: (
    maxConcurrent: number,
    maxEvents: number,
    maxStateBytes: number,
    requireController: boolean,
    allowedCallers: string[],
    minCyclesReserve: bigint | number,
  ) => Promise<LimitsDto>;
  start_execution: (executionId: string, initialStateJson: string) => Promise<RunReportDto>;
  step: (executionId: string, maxNodeSteps: number) => Promise<RunReportDto>;
  resume: (executionId: string) => Promise<RunReportDto>;
  continue_effects: (executionId: string) => Promise<RunReportDto>;
  accept_handoff: (
    executionId: string,
    envelopeJson: string,
    stateJson: string,
    parentAuthorityJson: string,
  ) => Promise<HandoffDto>;
  forward_handoff: (
    peerText: string,
    executionId: string,
    envelopeJson: string,
    stateJson: string,
    parentAuthorityJson: string,
  ) => Promise<HandoffDto>;
  get_handoff: (handoffId: string) => Promise<HandoffDto>;
  get_events: (executionId: string) => Promise<EventsDto>;
  get_checkpoint: (executionId: string) => Promise<CheckpointDto>;
}

/**
 * Ergonomic wrapper around an ICP agent runtime actor.
 * Construct with any object that implements {@link AgentRuntimeActor}
 * (typically from `Actor.createActor` in `@dfinity/agent`).
 */
export class IcpAgentRuntimeClient {
  constructor(private readonly actor: AgentRuntimeActor) {}

  health(): Promise<HealthDto> {
    return this.actor.health();
  }

  inspect(): Promise<InspectionDto> {
    return this.actor.inspect();
  }

  getBudget(): Promise<BudgetDto> {
    return this.actor.get_budget();
  }

  getLimits(): Promise<LimitsDto> {
    return this.actor.get_limits();
  }

  getStoreStats(): Promise<StoreStatsDto> {
    return this.actor.get_store_stats();
  }

  listExecutions(): Promise<ExecutionListDto> {
    return this.actor.list_executions();
  }

  loadDefinition(definition: unknown): Promise<HealthDto> {
    const json = typeof definition === "string" ? definition : JSON.stringify(definition);
    return this.actor.load_definition(json);
  }

  clearDefinition(): Promise<HealthDto> {
    return this.actor.clear_definition();
  }

  setLimits(opts: {
    maxConcurrentExecutions?: number;
    maxEventsPerExecution?: number;
    maxStateBytes?: number;
    requireControllerForRuns?: boolean;
    allowedCallers?: string[];
    minCyclesReserve?: bigint | number;
  }): Promise<LimitsDto> {
    return this.actor.set_limits(
      opts.maxConcurrentExecutions ?? 0,
      opts.maxEventsPerExecution ?? 0,
      opts.maxStateBytes ?? 0,
      opts.requireControllerForRuns ?? false,
      opts.allowedCallers ?? [],
      opts.minCyclesReserve ?? 0,
    );
  }

  startExecution(executionId: string, initialState: unknown): Promise<RunReportDto> {
    const stateJson =
      typeof initialState === "string" ? initialState : JSON.stringify(initialState);
    return this.actor.start_execution(executionId, stateJson);
  }

  step(executionId: string, maxNodeSteps = 1): Promise<RunReportDto> {
    return this.actor.step(executionId, maxNodeSteps);
  }

  resume(executionId: string): Promise<RunReportDto> {
    return this.actor.resume(executionId);
  }

  continueEffects(executionId: string): Promise<RunReportDto> {
    return this.actor.continue_effects(executionId);
  }

  acceptHandoff(
    executionId: string,
    envelope: unknown,
    state: unknown,
    parentAuthority: unknown,
  ): Promise<HandoffDto> {
    return this.actor.accept_handoff(
      executionId,
      typeof envelope === "string" ? envelope : JSON.stringify(envelope),
      typeof state === "string" ? state : JSON.stringify(state),
      typeof parentAuthority === "string"
        ? parentAuthority
        : JSON.stringify(parentAuthority),
    );
  }

  forwardHandoff(
    peerCanisterId: string,
    executionId: string,
    envelope: unknown,
    state: unknown,
    parentAuthority: unknown,
  ): Promise<HandoffDto> {
    return this.actor.forward_handoff(
      peerCanisterId,
      executionId,
      typeof envelope === "string" ? envelope : JSON.stringify(envelope),
      typeof state === "string" ? state : JSON.stringify(state),
      typeof parentAuthority === "string"
        ? parentAuthority
        : JSON.stringify(parentAuthority),
    );
  }

  getHandoff(handoffId: string): Promise<HandoffDto> {
    return this.actor.get_handoff(handoffId);
  }

  getEvents(executionId: string): Promise<EventsDto> {
    return this.actor.get_events(executionId);
  }

  getCheckpoint(executionId: string): Promise<CheckpointDto> {
    return this.actor.get_checkpoint(executionId);
  }
}

/**
 * Build a portable counter definition JSON for smoke tests (Phase 1 pure graph).
 * Off-chain only — pass the string to `loadDefinition`.
 */
export function portableCounterDefinition(): Record<string, unknown> {
  return {
    version: 1,
    implementation_id: "portable-counter-v1",
    pack_hash: "pack-none",
    policy_hash: "policy-none",
    contract_hash: "contract-none",
    graph: {
      version: 1,
      id: "portable-counter",
      state_schema: "counter-state",
      entry: "increment",
      nodes: [
        { id: "increment", terminal: false, reads: ["/count"], writes: ["/count"] },
        { id: "done", terminal: true, reads: ["/count"], writes: [] },
      ],
      transitions: [
        {
          id: "increment.continue.done",
          from: "increment",
          route: "continue",
          to: "done",
        },
      ],
      cycles: [],
      limits: {
        max_steps: 10,
        max_tokens: 100,
        max_cost_micros: 1000,
        timeout_ms: 30000,
      },
    },
    schema: {
      version: 1,
      id: "counter-state",
      paths: { "/count": "Number" },
      required: ["/count"],
    },
  };
}

export function portableCounterInitialState(count = 0): Record<string, unknown> {
  return {
    schema_id: "counter-state",
    revision: 0,
    value: { count },
    provenance: null,
  };
}
