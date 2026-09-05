import type { AgentAdapter, ContextEnvelopeV1, TaskV1 } from "../harness/types.js";
import type { MiddlewareHookName } from "./hooks.js";
import { MIDDLEWARE_HOOK_ORDER } from "./hooks.js";

export interface MiddlewareContext {
  readonly runId: string;
  readonly task: TaskV1;
  envelope: ContextEnvelopeV1;
  readonly adapter: AgentAdapter;
}

export type MiddlewareHandler = (ctx: MiddlewareContext, extra?: unknown) => void | Promise<void>;
export type Middleware = Partial<Record<MiddlewareHookName, MiddlewareHandler>>;

/** Hooks run in documented order. They may not replace compiled authority on the envelope. */
export async function runHooks(
  middleware: readonly Middleware[],
  name: MiddlewareHookName,
  ctx: MiddlewareContext,
  extra?: unknown,
): Promise<void> {
  const authority = ctx.envelope.capabilities;
  const root = ctx.envelope.dependencyRoot;
  for (const item of middleware) {
    const handler = item[name];
    if (handler) await handler(ctx, extra);
  }
  if (ctx.envelope.capabilities !== authority || ctx.envelope.dependencyRoot !== root) {
    throw new Error("middleware cannot bypass compiled authority or the frozen dependency root");
  }
}

export function assertKnownHook(name: string): asserts name is MiddlewareHookName {
  if (!(MIDDLEWARE_HOOK_ORDER as readonly string[]).includes(name)) throw new Error(`unknown middleware hook: ${name}`);
}
