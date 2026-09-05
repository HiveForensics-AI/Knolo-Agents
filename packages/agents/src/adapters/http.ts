import { HarnessError, type AgentAdapter, type AgentInvocationResultV1, type HarnessContextV1 } from "../harness/types.js";
import { normalizeInvocation } from "./callable.js";

export interface HttpAgentOptions {
  readonly url: string;
  readonly fetch: typeof fetch;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly id?: string;
  readonly mapRequest?: (input: unknown, ctx: HarnessContextV1) => unknown;
  readonly mapResponse?: (body: unknown) => AgentInvocationResultV1 | unknown;
}

export function httpAgent(options: HttpAgentOptions): AgentAdapter {
  if (typeof options.fetch !== "function") throw new HarnessError("httpAgent requires a host-provided fetch");
  const id = options.id ?? "http";
  return {
    descriptor: () => ({ version: 1, id, name: id, level: "L0" }),
    capabilities: () => ({
      version: 1,
      level: "L0",
      tools: false,
      resume: false,
      observe: false,
      interrupt: false,
      limitations: ["HTTP request/response only; tool gating requires a tool-aware adapter"],
    }),
    async invoke(input, ctx) {
      const body = options.mapRequest ? options.mapRequest(input, ctx) : { input, task: ctx.task };
      const response = await options.fetch(options.url, {
        method: options.method ?? "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (!response.ok) return { status: "failed", output: parsed, error: `http ${response.status}` };
      return normalizeInvocation(options.mapResponse ? options.mapResponse(parsed) : parsed);
    },
  };
}
