import type { AgentAdapter, AgentInvocationResultV1, HarnessContextV1 } from "../harness/types.js";

export type CallableAgentFn<I = unknown, O = unknown> = (input: I, ctx: HarnessContextV1) => O | AgentInvocationResultV1<O> | Promise<O | AgentInvocationResultV1<O>>;

export function callableAgent<I = unknown, O = unknown>(
  fn: CallableAgentFn<I, O>,
  options: { id?: string; name?: string } = {},
): AgentAdapter<I, O> {
  const id = options.id ?? "callable";
  return {
    descriptor: () => ({ version: 1, id, name: options.name ?? id, level: "L0" }),
    capabilities: () => ({
      version: 1,
      level: "L0",
      tools: false,
      resume: false,
      observe: false,
      interrupt: false,
      limitations: ["black-box callable; no tool interception"],
    }),
    async invoke(input, ctx) {
      const value = await fn(input, ctx);
      return normalizeInvocation(value);
    },
  };
}

export function normalizeInvocation<O>(value: O | AgentInvocationResultV1<O>): AgentInvocationResultV1<O> {
  if (value && typeof value === "object" && "status" in value && "output" in value) {
    const result = value as AgentInvocationResultV1<O>;
    if (result.status === "succeeded" || result.status === "partial" || result.status === "failed" || result.status === "suspended") return result;
  }
  return { status: "succeeded", output: value as O };
}
