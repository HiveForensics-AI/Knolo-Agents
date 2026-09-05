import type { JsonValue } from "../contracts/index.js";
import { HarnessError, type AgentAdapter, type AgentInvocationResultV1, type HarnessContextV1 } from "../harness/types.js";
import { normalizeInvocation } from "./callable.js";

export type ToolHandler = (args: JsonValue, ctx: HarnessContextV1) => unknown | Promise<unknown>;

export interface ToolAwareInvoke<I = unknown, O = unknown> {
  (input: I, ctx: HarnessContextV1, tools: ToolBridge): O | AgentInvocationResultV1<O> | Promise<O | AgentInvocationResultV1<O>>;
}

export interface ToolBridge {
  call(toolId: string, args?: JsonValue): Promise<unknown>;
}

export interface ToolAwareAgentOptions<I = unknown, O = unknown> {
  readonly invoke: ToolAwareInvoke<I, O>;
  readonly tools: Readonly<Record<string, ToolHandler>>;
  readonly id?: string;
  readonly name?: string;
}

export function toolAwareAgent<I = unknown, O = unknown>(options: ToolAwareAgentOptions<I, O>): AgentAdapter<I, O> {
  const id = options.id ?? "tool-aware";
  const allowed = new Set(Object.keys(options.tools));
  return {
    descriptor: () => ({ version: 1, id, name: options.name ?? id, level: "L1" }),
    capabilities: () => ({
      version: 1,
      level: "L1",
      tools: true,
      resume: false,
      observe: false,
      interrupt: false,
      limitations: ["tool calls are intercepted; model internals are not"],
    }),
    async invoke(input, ctx) {
      const toolCalls: string[] = [];
      const tools: ToolBridge = {
        async call(toolId, args = null) {
          if (!allowed.has(toolId)) throw new HarnessError(`tool is not registered: ${toolId}`);
          const prohibited = ctx.task.prohibitedActions ?? [];
          if (prohibited.includes(toolId)) throw new HarnessError(`tool is prohibited by task policy: ${toolId}`);
          await ctx.emitTool?.("before", toolId, args);
          const result = await options.tools[toolId]!(args, ctx);
          toolCalls.push(toolId);
          await ctx.emitTool?.("after", toolId, result as JsonValue);
          return result;
        },
      };
      const value = await options.invoke(input, ctx, tools);
      const result = normalizeInvocation(value);
      return { ...result, toolCalls: [...(result.toolCalls ?? []), ...toolCalls] };
    },
  };
}
