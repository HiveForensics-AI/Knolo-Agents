import type { JsonValue } from "../contracts/index.js";
import type { CortexCapability } from "../cortex/index.js";
import { loadCoreV5, requireCoreV5 } from "./load.js";

type CortexCore = {
  createCortex: (opts?: { actor?: string }) => unknown;
  remember: (cortex: unknown, input: { text: string; kind?: string; labels?: readonly string[] }) => { cortex: unknown; memory: unknown };
  recall: (cortex: unknown, query: string, opts?: Record<string, unknown>) => unknown[];
};

export interface CortexQueryV5 {
  readonly query?: string;
  readonly topK?: number;
}

/** Maps Core V5 Cortex remember/recall onto the legacy `CortexCapability` injection interface. */
export class V5CortexAdapter implements CortexCapability<JsonValue, JsonValue, JsonValue> {
  private cortex: unknown;

  private constructor(private readonly core: CortexCore, cortex?: unknown) {
    this.cortex = cortex ?? core.createCortex({ actor: "knolo-agents" });
  }

  static async create(core?: CortexCore): Promise<V5CortexAdapter> {
    return new V5CortexAdapter(core ?? ((await loadCoreV5()) as unknown as CortexCore));
  }

  static from(core: CortexCore | null | undefined, cortex?: unknown): V5CortexAdapter {
    return new V5CortexAdapter(requireCoreV5(core), cortex);
  }

  remember(text: string, labels: readonly string[] = []): unknown {
    const result = this.core.remember(this.cortex, { text, kind: "note", labels });
    this.cortex = result.cortex;
    return result.memory;
  }

  async query(request: JsonValue): Promise<JsonValue> {
    const parsed = parseQuery(request);
    return this.core.recall(this.cortex, parsed.query ?? "", parsed.topK ? { topK: parsed.topK } : {}) as JsonValue;
  }

  async context(request: JsonValue): Promise<JsonValue> {
    const memories = await this.query(request);
    return { memories };
  }
}

function parseQuery(request: JsonValue): CortexQueryV5 {
  if (typeof request === "string") return { query: request };
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const record = request as { readonly query?: JsonValue; readonly topK?: JsonValue };
    return {
      query: typeof record.query === "string" ? record.query : "",
      ...(typeof record.topK === "number" ? { topK: record.topK } : {}),
    };
  }
  return { query: JSON.stringify(request) };
}

/** Pass-through for hosts that already implement the legacy Cortex interface. */
export class LegacyCortexAdapter<Q extends JsonValue = JsonValue, R extends JsonValue = JsonValue, C extends JsonValue = JsonValue> implements CortexCapability<Q, R, C> {
  constructor(private readonly inner: CortexCapability<Q, R, C>) {}
  query(request: Q): Promise<R> {
    return this.inner.query(request);
  }
  context(request: Q): Promise<C> {
    return this.inner.context(request);
  }
}
