import { DefinitionError } from "../../builder/index.js";
import type { CompiledAgentDefinition } from "../../builder/index.js";
import type { AgentInspection, CheckpointV1, EngineCommand, EngineResponse, ExecutionEventV1, ExecutionReport, JsonValue } from "../../contracts/index.js";
import type { Engine, RunOptions } from "../typescript/index.js";

export interface WasmProtocolAdapter { command(request: string): string | Promise<string> }
export class WasmEngine<S> implements Engine<S> {
  readonly name = "wasm" as const;
  constructor(private readonly definition: CompiledAgentDefinition<S>, private readonly adapter: WasmProtocolAdapter) { if (!adapter) throw new DefinitionError("wasm engine requires an explicit adapter; no fallback is performed"); }
  inspect(): AgentInspection { return { engine: this.name, graph: this.definition.graph, capabilities: ["state", "routing", "suspension"], limitations: ["host node handlers use the versioned command/event boundary"] }; }
  execute(initial: S, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> { return this.send({ type: "run", execution_id: options.executionId ?? `wasm-${Date.now()}`, state: initial as JsonValue }, options.signal); }
  resume(checkpoint: CheckpointV1, input: unknown, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> { return this.send({ type: "resume", checkpoint, input: input as JsonValue }, options.signal); }
  private async *send(command: EngineCommand, signal?: AbortSignal): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> { if (signal?.aborted) return cancelled<S>(); const raw = await this.adapter.command(JSON.stringify({ version: 1, command, graph: this.definition.graph })); const responses = JSON.parse(raw) as readonly EngineResponse<S>[]; let final: ExecutionReport<S> | undefined; for (const response of responses) { if (signal?.aborted) return cancelled<S>(); if (response.type === "event") yield response.event; else if (response.type === "report") final = response.report; else if (response.type === "error") throw new DefinitionError(`${response.failure.type}: ${"message" in response.failure ? response.failure.message : response.failure.capability}`); } if (!final) throw new DefinitionError("wasm adapter returned no report"); return final; }
}
function cancelled<S>(): ExecutionReport<S> { return { status: { type: "cancelled" }, state: { schema_id: "cancelled", revision: 0, value: undefined as S, provenance: null }, events: [], steps: 0, tokens: 0, cost_micros: 0 }; }
