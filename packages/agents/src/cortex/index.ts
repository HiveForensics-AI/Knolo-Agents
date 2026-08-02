import type { JsonValue } from "../contracts/index.js";

/** Injected boundary implemented by @knolo/core; agents never own Cortex data. */
export interface CortexCapability<Q extends JsonValue = JsonValue, R extends JsonValue = JsonValue, C extends JsonValue = JsonValue> {
  query(request: Q): Promise<R>;
  context(request: Q): Promise<C>;
}
export const cortexQuery = async <Q extends JsonValue, R extends JsonValue>(core: Pick<CortexCapability<Q, R>, "query">, request: Q): Promise<R> => core.query(request);
export const cortexContext = async <Q extends JsonValue, C extends JsonValue>(core: Pick<CortexCapability<Q, JsonValue, C>, "context">, request: Q): Promise<C> => core.context(request);
