import { DefinitionError } from "../../builder/index.js";
import type { CompiledAgentDefinition, NodeHandler } from "../../builder/index.js";
import type { AgentInspection, CheckpointV1, EngineCommand, EngineResponse, ExecutionEventV1, ExecutionReport, JsonValue, NodeExecution, WasmNodeExecution } from "../../contracts/index.js";
import type { Engine, RunOptions } from "../typescript/index.js";

export interface WasmProtocolAdapter { command(request: string): string | Promise<string> }

const capabilities = ["state", "routing", "suspension"] as const;
const limitations = ["host node handlers use the versioned continue boundary", "tools, retrieval, and durable effects stay host-bound"] as const;

export class WasmEngine<S> implements Engine<S> {
  readonly name = "wasm" as const;
  constructor(private readonly definition: CompiledAgentDefinition<S>, private readonly adapter: WasmProtocolAdapter) {
    if (!adapter) throw new DefinitionError("wasm engine requires an explicit adapter; no fallback is performed");
  }
  inspect(): AgentInspection {
    return { engine: this.name, graph: this.definition.graph, capabilities: [...capabilities], limitations: [...limitations] };
  }
  execute(initial: S, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> {
    return this.drive({ type: "run", execution_id: options.executionId ?? `wasm-${Date.now()}`, state: initial }, options);
  }
  resume(checkpoint: CheckpointV1, input: unknown, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> {
    return this.drive({ type: "resume", checkpoint, input: input as JsonValue }, { ...options, resumeInput: input as JsonValue });
  }
  private async *drive(initial: EngineCommand<S>, options: RunOptions): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> {
    let command: EngineCommand<S> = initial;
    while (true) {
      if (options.signal?.aborted) return cancelled<S>();
      const raw = await this.adapter.command(JSON.stringify({
        version: 1,
        command,
        graph: this.definition.graph,
        schema: this.definition.schema,
        now_ms: Date.now(),
      }));
      const responses = JSON.parse(raw) as readonly EngineResponse<S>[];
      let final: ExecutionReport<S> | undefined;
      let next: EngineCommand<S> | undefined;
      for (const response of responses) {
        if (options.signal?.aborted) return cancelled<S>();
        if (response.type === "event") yield response.event;
        else if (response.type === "report") final = response.report;
        else if (response.type === "error") throw new DefinitionError(`${response.failure.type}: ${"message" in response.failure ? response.failure.message : response.failure.capability}`);
        else if (response.type === "dispatch") {
          const handler = this.definition.handlers[response.request.node_id] as NodeHandler<S> | undefined;
          if (!handler) throw new DefinitionError(`node ${response.request.node_id} has no handler`);
          const execution = await handler({
            state: response.request.state as S,
            attempt: response.request.attempt,
            signal: options.signal ?? neverAbort(),
            resumeInput: options.resumeInput,
          });
          next = { type: "continue", session: response.session, execution: protocolExecution(execution, response.request.state as S) };
        } else if (response.type === "inspection") {
          throw new DefinitionError("wasm adapter returned inspection during execute/resume");
        }
      }
      if (final) return { ...final, snapshots: final.snapshots ?? [] };
      if (!next) throw new DefinitionError("wasm adapter returned no report");
      command = next;
    }
  }
}

function protocolExecution<S>(execution: NodeExecution<S>, state: S): WasmNodeExecution<S> {
  const outcome = execution.outcome;
  if (!("patch" in outcome) || outcome.patch === undefined) {
    return { outcome: outcome as WasmNodeExecution<S>["outcome"], tokens: execution.tokens, cost_micros: execution.cost_micros };
  }
  const patch = typeof outcome.patch === "function" ? outcome.patch(state) : outcome.patch;
  return { outcome: { ...outcome, patch }, tokens: execution.tokens, cost_micros: execution.cost_micros };
}

function cancelled<S>(): ExecutionReport<S> {
  return { status: { type: "cancelled" }, state: { schema_id: "cancelled", revision: 0, value: undefined as S, provenance: null }, events: [], steps: 0, tokens: 0, cost_micros: 0, snapshots: [] };
}

let signal: AbortSignal | undefined;
function neverAbort(): AbortSignal { return signal ??= new AbortController().signal; }
