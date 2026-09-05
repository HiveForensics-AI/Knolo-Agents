import { knoloMcpBridge, KNOLO_MCP_TOOLS } from "../../../packages/agents/dist/index.js";
import { promptFromContext } from "../shared/contracts.mjs";

/**
 * L0/L1 Grok adapter. Host owns networking (`complete` over the xAI chat API).
 * Function-calling tools are the same Knolo MCP names used by the Grok Build example.
 */
export function grokAgent(options) {
  if (typeof options?.complete !== "function") throw new Error("grokAgent requires a host-owned complete()");
  const mcp = options.mcp ?? (options.tools === "mcp"
    ? knoloMcpBridge({ extraTools: options.extraTools, extraHandlers: options.extraHandlers })
    : undefined);
  const id = options.id ?? "grok";
  const level = mcp ? "L1" : "L0";
  return {
    descriptor: () => ({ version: 1, id, name: options.name ?? id, level }),
    capabilities: () => ({
      version: 1,
      level,
      tools: Boolean(mcp),
      resume: false,
      observe: false,
      interrupt: false,
      limitations: mcp
        ? ["host-owned Grok client; Knolo MCP function calling only"]
        : ["host-owned Grok client; black-box chat completions"],
    }),
    async invoke(input, ctx) {
      const bound = mcp;
      const tools = bound ? bound.listTools().map(toGrokTool) : undefined;
      const messages = [{ role: "user", content: promptFromContext(ctx, input) }];
      const toolCalls = [];
      const maxSteps = ctx.envelope.budget.maxSteps ?? 8;
      let tokens = 0;
      for (let step = 0; step < maxSteps; step += 1) {
        const response = await options.complete({
          model: options.model ?? "grok-4",
          messages,
          ...(tools ? { tools } : {}),
        });
        const choice = response?.choices?.[0]?.message ?? response?.message ?? response;
        tokens += Number(response?.usage?.total_tokens ?? 0);
        const calls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
        if (!calls.length || !bound) {
          const text = String(choice?.content ?? choice?.output ?? "");
          return { status: "succeeded", output: text, toolCalls, tokens: tokens || undefined };
        }
        messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: calls });
        for (const call of calls) {
          const name = String(call.function?.name ?? call.name ?? "");
          toolCalls.push(name);
          let args = call.function?.arguments ?? call.arguments ?? {};
          if (typeof args === "string") {
            try { args = JSON.parse(args); } catch { args = { raw: args }; }
          }
          await ctx.emitTool?.("before", name, args);
          const result = await bound.callTool(name, args, ctx);
          await ctx.emitTool?.("after", name, result.structured ?? result.content);
          messages.push({
            role: "tool",
            tool_call_id: call.id ?? name,
            content: result.content.map(item => item.text).join("\n"),
          });
        }
      }
      return { status: "partial", output: "grok tool loop exhausted step budget", error: "timeout", toolCalls, tokens: tokens || undefined };
    },
  };
}

export function toGrokTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object" },
    },
  };
}

export { KNOLO_MCP_TOOLS };
