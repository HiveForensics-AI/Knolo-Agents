import { httpAgent, knoloMcpBridge } from "../../../packages/agents/dist/index.js";
import { promptFromContext } from "../shared/contracts.mjs";

/** Pinned hook names from the conversion plan. OpenClaw plugin APIs are experimental. */
export const OPENCLAW_PLUGIN_API = {
  host: "openclaw",
  hooks: ["before_prompt_build", "before_tool_call", "agent_end"],
  experimental: true,
};

/**
 * L2 OpenClaw plugin. Injects compiled Knolo context, gates tools, evaluates at end.
 * The host owns the OpenClaw runtime; this file never imports an OpenClaw SDK.
 */
export function openClawPlugin(options = {}) {
  return {
    id: options.id ?? "knolo-harness",
    api: OPENCLAW_PLUGIN_API,
    async before_prompt_build(event) {
      const ctx = event.ctx;
      if (!ctx) return { ...event, skipped: "missing harness context" };
      const compiled = promptFromContext(ctx, event.input);
      return {
        prompt: [event.prompt, compiled].filter(Boolean).join("\n\n"),
        system: ctx.envelope,
        dependencyRoot: ctx.envelope.dependencyRoot,
      };
    },
    async before_tool_call(event) {
      const toolId = String(event.toolId ?? event.name ?? "");
      const prohibited = event.ctx?.task.prohibitedActions ?? [];
      if (prohibited.includes(toolId)) {
        return { allow: false, reason: `tool is prohibited by task policy: ${toolId}` };
      }
      if (options.mcp && event.ctx) {
        const bound = knoloMcpBridge({ ctx: event.ctx });
        const known = new Set(bound.listTools().map(tool => tool.name));
        if (known.has(toolId)) {
          const result = await bound.callTool(toolId, event.args ?? null, event.ctx);
          return { allow: true, handled: true, result };
        }
      }
      return { allow: true };
    },
    async agent_end(event) {
      const ctx = event.ctx;
      if (!ctx) return { evaluation: null };
      const bound = knoloMcpBridge({ ctx });
      const evaluation = await bound.callTool("knolo.evaluate", {
        output: event.output ?? "",
        status: event.status ?? "succeeded",
        toolCalls: event.toolCalls ?? [],
      }, ctx);
      return { evaluation: evaluation.structured ?? evaluation };
    },
  };
}

/** L2 adapter that drives the plugin hooks around a host-owned complete(). */
export function openClawAgent(options) {
  if (typeof options?.complete !== "function") throw new Error("openClawAgent requires a host-owned complete()");
  const plugin = options.plugin ?? openClawPlugin({ mcp: options.mcp !== false });
  const id = options.id ?? "openclaw";
  return {
    descriptor: () => ({ version: 1, id, name: options.name ?? id, level: "L2" }),
    capabilities: () => ({
      version: 1,
      level: "L2",
      tools: true,
      resume: false,
      observe: true,
      interrupt: false,
      limitations: ["OpenClaw plugin hooks only; host APIs are experimental and version-pinned"],
    }),
    async invoke(input, ctx) {
      const built = await plugin.before_prompt_build({ ctx, input, prompt: options.prompt ?? "" });
      const events = [{ hook: "before_prompt_build", dependencyRoot: built.dependencyRoot ?? ctx.envelope.dependencyRoot }];
      const response = await options.complete({ prompt: built.prompt, envelope: built.system, input });
      const pendingTools = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
      const toolCalls = [];
      for (const call of pendingTools) {
        const toolId = String(call.toolId ?? call.name ?? "");
        const gate = await plugin.before_tool_call({ ctx, toolId, args: call.args ?? null });
        events.push({ hook: "before_tool_call", toolId, allow: gate.allow !== false });
        if (gate.allow === false) {
          return { status: "failed", output: response?.output ?? "", error: gate.reason, toolCalls, events };
        }
        toolCalls.push(toolId);
      }
      const output = String(response?.output ?? response ?? "");
      const ended = await plugin.agent_end({ ctx, input, output, status: "succeeded", toolCalls });
      events.push({ hook: "agent_end" });
      return { status: "succeeded", output, toolCalls, events, evaluation: ended.evaluation };
    },
  };
}

/** L0 HTTP fallback when OpenClaw plugin hooks are unavailable. */
export function openClawHttpFallback(options) {
  return httpAgent({
    url: options.url,
    fetch: options.fetch,
    id: options.id ?? "openclaw-http",
    mapRequest: options.mapRequest ?? ((input, ctx) => ({ input, task: ctx.task, envelope: ctx.envelope })),
    mapResponse: options.mapResponse,
  });
}
