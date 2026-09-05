import { knoloMcpBridge, KNOLO_MCP_TOOLS } from "../../../packages/agents/dist/index.js";
import { promptFromContext } from "../shared/contracts.mjs";

/**
 * L0/L1 Grok Build session adapter. The host owns the Grok Build complete()
 * (headless `grok -p`, a recorded session turn, or an injected xAI client).
 * No Anthropic/Claude SDK. Optional Knolo MCP tools use the same names as Grok.
 */
export function grokBuildAgent(options) {
  if (typeof options?.complete !== "function") throw new Error("grokBuildAgent requires a host-owned complete()");
  const mcp = options.mcp ?? (options.tools === "mcp"
    ? knoloMcpBridge({ extraTools: options.extraTools, extraHandlers: options.extraHandlers })
    : undefined);
  const id = options.id ?? "grok-build";
  const level = mcp ? "L1" : "L0";
  return {
    descriptor: () => ({ version: 1, id, name: options.name ?? "Grok Build", level }),
    capabilities: () => ({
      version: 1,
      level,
      tools: Boolean(mcp),
      resume: false,
      observe: false,
      interrupt: false,
      limitations: mcp
        ? ["host-owned Grok Build session; Knolo MCP tools only"]
        : ["host-owned Grok Build session; black-box prompt"],
    }),
    async invoke(input, ctx) {
      const bound = mcp;
      const tools = bound ? bound.listTools().map(toGrokBuildTool) : undefined;
      const prompt = promptFromContext(ctx, input);
      const messages = [{ role: "user", content: prompt }];
      const toolCalls = [];
      const maxSteps = ctx.envelope.budget.maxSteps ?? 8;
      let tokens = 0;
      for (let step = 0; step < maxSteps; step += 1) {
        const response = await options.complete({
          model: options.model ?? "grok-4.6",
          sessionId: options.sessionId ?? ctx.runId,
          prompt,
          messages,
          ...(tools ? { tools } : {}),
        });
        const choice = response?.choices?.[0]?.message ?? response?.message ?? response;
        tokens += Number(response?.usage?.total_tokens ?? 0);
        const calls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
        if (!calls.length || !bound) {
          const text = String(choice?.content ?? choice?.output ?? response?.output ?? "");
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
      return { status: "partial", output: "grok-build tool loop exhausted step budget", error: "timeout", toolCalls, tokens: tokens || undefined };
    },
  };
}

export function toGrokBuildTool(tool) {
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
