import { compile, DefinitionError } from "../builder/index.js";
import type { AgentDefinition, CompiledAgentDefinition } from "../builder/index.js";
import type { AgentInspection, CheckpointV1, EngineName, ExecutionEventV1, ExecutionReport, JsonValue } from "../contracts/index.js";
import { TypeScriptEngine } from "../engine/typescript/index.js";
import type { Engine, RunOptions } from "../engine/typescript/index.js";
import { WasmEngine } from "../engine/wasm/index.js";
import type { WasmProtocolAdapter } from "../engine/wasm/index.js";

export interface AgentLoadOptions<S> { readonly definition: AgentDefinition<S> | CompiledAgentDefinition<S>; readonly engine: EngineName; readonly wasm?: WasmProtocolAdapter }
export interface ResumeOptions extends Omit<RunOptions, "resumeInput"> {}

/** A loaded definition bound to exactly one explicitly selected execution engine. */
export class Agent<S, ResumeInput = JsonValue, Result = JsonValue> {
  private constructor(private readonly definition: CompiledAgentDefinition<S>, private readonly engine: Engine<S>) {}
  static load<S, I = JsonValue, R = JsonValue>(options: AgentLoadOptions<S>): Agent<S, I, R> {
    const definition = "hash" in options.definition ? options.definition : compile(options.definition);
    if (options.engine === "typescript") return new Agent(definition, new TypeScriptEngine(definition));
    if (!options.wasm) throw new DefinitionError("wasm was selected but no adapter was supplied; engines never silently fall back");
    return new Agent(definition, new WasmEngine(definition, options.wasm));
  }
  stream(initial: S, options?: RunOptions): AsyncIterable<ExecutionEventV1> { return eventsOnly(this.engine.execute(initial, options)); }
  async run(initial: S, options?: RunOptions): Promise<ExecutionReport<S, Result>> { return consume(this.engine.execute(initial, options)) as Promise<ExecutionReport<S, Result>>; }
  async resume(checkpoint: CheckpointV1, input: ResumeInput, options?: ResumeOptions): Promise<ExecutionReport<S, Result>> { return consume(this.engine.resume(checkpoint, input, options)) as Promise<ExecutionReport<S, Result>>; }
  replay(events: readonly ExecutionEventV1[]): readonly ExecutionEventV1[] { let previous = 0; for (const event of events) { if (event.version !== 1 || event.sequence !== previous + 1) throw new DefinitionError("replay events must be version 1 and contiguous"); previous = event.sequence; } return events.map(event => structuredClone(event)); }
  inspect(): AgentInspection { return this.engine.inspect(); }
  serialized(): CompiledAgentDefinition<S>["graph"] { return this.definition.graph; }
}
async function consume<S>(iterator: AsyncGenerator<ExecutionEventV1, ExecutionReport<S>>): Promise<ExecutionReport<S>> { while (true) { const next = await iterator.next(); if (next.done) return next.value; } }
async function* eventsOnly<S>(iterator: AsyncGenerator<ExecutionEventV1, ExecutionReport<S>>): AsyncGenerator<ExecutionEventV1> { while (true) { const next = await iterator.next(); if (next.done) return; yield next.value; } }
