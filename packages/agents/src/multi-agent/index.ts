import type { JsonValue } from "../contracts/index.js";
export interface AuthorityV1 { readonly capabilities: readonly string[]; readonly namespaces: readonly string[]; readonly maxSteps: number; readonly maxCostMicros: number }
export interface HandoffEnvelopeV1<S extends JsonValue = JsonValue> { readonly version: 1; readonly destination: string; readonly stateProjection: Readonly<Record<string, keyof S & string>>; readonly authorityProjection: AuthorityV1; readonly returnContract: string }
export const assertNarrowAuthority = (child: AuthorityV1, parent: AuthorityV1, pack: AuthorityV1): void => {
  const subset = (a: readonly string[], b: readonly string[]): boolean => a.every((item) => b.includes(item));
  if (!subset(child.capabilities, parent.capabilities) || !subset(child.capabilities, pack.capabilities) || !subset(child.namespaces, parent.namespaces) || !subset(child.namespaces, pack.namespaces) || child.maxSteps > Math.min(parent.maxSteps, pack.maxSteps) || child.maxCostMicros > Math.min(parent.maxCostMicros, pack.maxCostMicros)) throw new Error("handoff authority escalation");
};
