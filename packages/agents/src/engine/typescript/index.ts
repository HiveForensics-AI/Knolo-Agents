import { DefinitionError, validateDefinition } from "../../builder/index.js";
import type { AgentDefinition, CompiledAgentDefinition, NodeHandler } from "../../builder/index.js";
import type { AgentInspection, CheckpointV1, EngineName, ExecutionEventV1, ExecutionReport, ExecutionStatus, JsonValue, NodeExecution, StateSnapshot } from "../../contracts/index.js";

export interface RunOptions<I = JsonValue> { readonly signal?: AbortSignal; readonly executionId?: string; readonly resumeInput?: I }
export interface Engine<S> { readonly name: EngineName; inspect(): AgentInspection; execute(initial: S, options?: RunOptions): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>>; resume(checkpoint: CheckpointV1, input: unknown, options?: RunOptions): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> }
const supported = new Set(["state", "routing", "suspension"]);

export class TypeScriptEngine<S> implements Engine<S> {
  readonly name = "typescript" as const;
  constructor(private readonly definition: CompiledAgentDefinition<S>) { validateDefinition(definition.graph); const missing = definition.capabilities.filter(x => !supported.has(x)); if (missing.length) throw new DefinitionError(`typescript engine does not support capabilities: ${missing.join(", ")}`); }
  inspect(): AgentInspection { return { engine: this.name, graph: this.definition.graph, capabilities: [...supported], limitations: ["tool execution is host-provided", "durable checkpoints require a host store"] }; }
  execute(initial: S, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> { const snapshot: StateSnapshot<S> = { schema_id: this.definition.schema.id, revision: 0, value: structuredClone(initial), provenance: null }; return this.runFrom(snapshot, this.definition.graph.entry, 0, 0, 0, options.executionId ?? randomId(), options); }
  resume(checkpoint: CheckpointV1, input: unknown, options: RunOptions = {}): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> { if (checkpoint.graph_hash !== this.definition.hash) throw new DefinitionError("checkpoint graph hash mismatch"); return this.runFrom(checkpoint.state as StateSnapshot<S>, checkpoint.pending_node, checkpoint.event_cursor, checkpoint.steps, checkpoint.tokens, checkpoint.execution_id, { ...options, resumeInput: input as JsonValue }); }
  private async *runFrom(stateInput: StateSnapshot<S>, startNode: string, cursor: number, initialSteps: number, initialTokens: number, executionId: string, options: RunOptions): AsyncGenerator<ExecutionEventV1, ExecutionReport<S>> {
    let state = stateInput, current = startNode, sequence = cursor, steps = initialSteps, tokens = initialTokens, cost = 0; const events: ExecutionEventV1[] = []; const startedAt = Date.now(); const visits = new Map<string, number>();
    const emit = (kind: ExecutionEventV1["kind"], nodeId: string | null): ExecutionEventV1 => { const event: ExecutionEventV1 = { version: 1, sequence: ++sequence, execution_id: executionId, node_id: nodeId, timestamp_ms: Date.now(), kind }; events.push(event); return event; };
    if (cursor === 0) yield emit({ type: "execution_started" }, null);
    while (true) {
      if (options.signal?.aborted) { yield emit({ type: "cancelled" }, current); return report({ type: "cancelled" }, state, events, steps, tokens, cost); }
      const l = this.definition.graph.limits; if (steps >= l.max_steps) { yield emit({ type: "failed", error: "step budget exceeded" }, current); return report({ type: "failed", error: "step budget exceeded" }, state, events, steps, tokens, cost); }
      if (Date.now() - startedAt > l.timeout_ms) { yield emit({ type: "failed", error: "timeout budget exceeded" }, current); return report({ type: "failed", error: "timeout budget exceeded" }, state, events, steps, tokens, cost); }
      const count = (visits.get(current) ?? 0) + 1; visits.set(current, count); const cycle = this.definition.graph.cycles.find(c => c.nodes.includes(current)); if (cycle && count > cycle.max_iterations) { yield emit({ type: "failed", error: "cycle limit exceeded" }, current); return report({ type: "failed", error: "cycle limit exceeded" }, state, events, steps, tokens, cost); }
      const node = this.definition.graph.nodes.find(n => n.id === current)!; const handler = this.definition.handlers[current] as NodeHandler<S> | undefined; if (!handler) throw new DefinitionError(`node ${current} has no handler`);
      yield emit({ type: "node_started", attempt: 1 }, current); let execution: NodeExecution<S>; try { execution = await handler({ state: state.value, attempt: 1, signal: options.signal ?? neverAbort(), resumeInput: options.resumeInput }); } catch (error) { const message = error instanceof Error ? error.message : String(error); yield emit({ type: "failed", error: message }, current); return report({ type: "failed", error: message }, state, events, steps, tokens, cost); }
      steps++; tokens += execution.tokens ?? 0; cost += execution.cost_micros ?? 0; if (tokens > l.max_tokens || cost > l.max_cost_micros) { const error = tokens > l.max_tokens ? "token budget exceeded" : "cost budget exceeded"; yield emit({ type: "failed", error }, current); return report({ type: "failed", error }, state, events, steps, tokens, cost); }
      const patch = "patch" in execution.outcome ? execution.outcome.patch : undefined; if (patch) { const update = typeof patch === "function" ? patch(state.value) : patch; for (const key of Object.keys(update)) if (!node.writes.includes(`/${key}`)) throw new DefinitionError(`node ${current} wrote undeclared state key ${key}`); state = { schema_id: state.schema_id, revision: state.revision + 1, value: { ...state.value, ...update }, provenance: { execution_id: executionId, node_id: current, event_sequence: sequence + 1 } }; yield emit({ type: "state_patched", revision: state.revision }, current); }
      const outcome = execution.outcome;
      if (outcome.type === "terminate") { yield emit({ type: "terminated" }, current); return report({ type: "terminated", result: outcome.result }, state, events, steps, tokens, cost); }
      if (outcome.type === "suspend") { yield emit({ type: "suspended", reason: outcome.reason }, current); return report({ type: "suspended", reason: outcome.reason }, state, events, steps, tokens, cost); }
      if (outcome.type === "fail") { yield emit({ type: "failed", error: outcome.error }, current); return report({ type: "failed", error: outcome.error }, state, events, steps, tokens, cost); }
      const route = outcome.type === "route" ? outcome.route : "continue"; const edge = this.definition.graph.transitions.find(t => t.from === current && t.route === route); if (!edge) throw new DefinitionError(`undeclared route ${route} from ${current}`); if (outcome.type === "route") yield emit({ type: "routed", route, to: edge.to }, current); yield emit({ type: "checkpointed" }, current); current = edge.to;
    }
  }
}
function report<S>(status: ExecutionStatus, state: StateSnapshot<S>, events: readonly ExecutionEventV1[], steps: number, tokens: number, cost_micros: number): ExecutionReport<S> { return { status, state, events, steps, tokens, cost_micros }; }
let ids = 0; function randomId(): string { return `ts-${Date.now().toString(36)}-${(++ids).toString(36)}`; }
let signal: AbortSignal | undefined; function neverAbort(): AbortSignal { return signal ??= new AbortController().signal; }
