import type { Agent } from "../agent/index.js";
import type { CheckpointV1, ExecutionReport, JsonValue } from "../contracts/index.js";
import { HarnessError, type AgentAdapter, type AgentInvocationResultV1, type HarnessCheckpointV1 } from "../harness/types.js";

export interface NativeKnoloAgentOptions<S> {
  readonly id?: string;
  readonly initialState?: S;
  readonly mapInput?: (input: unknown) => S;
}

export function nativeKnoloAgent<S>(agent: Agent<S>, options: NativeKnoloAgentOptions<S> = {}): AgentAdapter {
  const inspection = agent.inspect();
  const id = options.id ?? inspection.graph.id;
  return {
    descriptor: () => ({ version: 1, id, name: id, level: "L3" }),
    capabilities: () => ({
      version: 1,
      level: "L3",
      tools: false,
      resume: true,
      observe: false,
      interrupt: false,
      limitations: inspection.limitations,
    }),
    async invoke(input, ctx) {
      const state = resolveState(input, options);
      const report = await agent.run(state, { executionId: ctx.runId, signal: ctx.signal });
      return fromReport(report);
    },
    async resume(checkpoint: HarnessCheckpointV1) {
      const payload = checkpoint.payload as { checkpoint?: CheckpointV1; input?: unknown };
      if (!payload?.checkpoint) throw new HarnessError("nativeKnoloAgent resume requires a graph checkpoint payload");
      const report = await agent.resume(payload.checkpoint, payload.input as never);
      return fromReport(report);
    },
  };
}

function resolveState<S>(input: unknown, options: NativeKnoloAgentOptions<S>): S {
  if (options.mapInput) return options.mapInput(input);
  if (input !== undefined && input !== null) return input as S;
  if (options.initialState !== undefined) return options.initialState;
  throw new HarnessError("nativeKnoloAgent requires input state or initialState");
}

function fromReport(report: ExecutionReport<unknown>): AgentInvocationResultV1<JsonValue> {
  if (report.status.type === "terminated") {
    return { status: "succeeded", output: report.status.result, tokens: report.tokens, events: report.events as unknown as JsonValue[] };
  }
  if (report.status.type === "suspended") {
    return { status: "suspended", output: report.state.value as JsonValue, error: report.status.reason, tokens: report.tokens };
  }
  if (report.status.type === "cancelled") {
    return { status: "failed", output: report.state.value as JsonValue, error: "cancelled", tokens: report.tokens };
  }
  return { status: "failed", output: report.state.value as JsonValue, error: report.status.error, tokens: report.tokens };
}
