import type { CycleDefinitionV1, ExecutionLimitsV1, GraphDefinitionV1, JsonValue, NodeDefinitionV1, NodeExecution, StateSchemaV1, TransitionDefinitionV1, ValueType } from "../contracts/index.js";

type SchemaShape = Record<string, ValueType | { readonly type: ValueType; readonly optional?: boolean }>;
type TypeOfValue<T> = T extends "String" ? string : T extends "Number" ? number : T extends "Bool" ? boolean : T extends "Array" ? readonly JsonValue[] : T extends "Object" ? Record<string, JsonValue> : T extends "Null" ? null : never;
export type InferState<T extends SchemaShape> = { [K in keyof T as T[K] extends { optional: true } ? never : K]: TypeOfValue<T[K] extends { type: infer V } ? V : T[K]> } & { [K in keyof T as T[K] extends { optional: true } ? K : never]?: TypeOfValue<T[K] extends { type: infer V } ? V : T[K]> };
export interface TypedStateSchema<S, Id extends string = string> extends StateSchemaV1 { readonly id: Id; readonly __state?: S }
export type StateOf<T> = T extends TypedStateSchema<infer S> ? S : never;

const identifier = /^[A-Za-z0-9_.\/-]{1,128}$/;
function assertIdentifier(value: string, label: string): void { if (!identifier.test(value)) throw new DefinitionError(`${label} is not a valid identifier: ${value}`); }
export class DefinitionError extends Error { readonly type = "definition"; constructor(message: string) { super(message); this.name = "DefinitionError"; } }

export function stateSchema<const Id extends string, const Shape extends SchemaShape>(id: Id, shape: Shape): TypedStateSchema<InferState<Shape>, Id> {
  assertIdentifier(id, "state schema id"); const paths: Record<string, ValueType> = {}; const required: string[] = [];
  for (const [key, descriptor] of Object.entries(shape)) { const path = key.startsWith("/") ? key : `/${key}`; const item = typeof descriptor === "string" ? { type: descriptor, optional: false } : descriptor; paths[path] = item.type; if (!item.optional) required.push(path); }
  return { version: 1, id, paths, required } as TypedStateSchema<InferState<Shape>, Id>;
}
export interface NodeSpec<S, Id extends string = string, Routes extends string = string> extends NodeDefinitionV1 { readonly id: Id; readonly handler?: NodeHandler<S, Routes>; readonly capabilities?: readonly string[] }
export interface NodeContext<S> { readonly state: Readonly<S>; readonly attempt: number; readonly signal: AbortSignal; readonly resumeInput?: unknown }
export type NodeHandler<S, Routes extends string = string> = (context: NodeContext<S>) => NodeExecution<S> | Promise<NodeExecution<S>>;
export function node<S, const Id extends string, const Routes extends string = "continue">(id: Id, options: { reads?: readonly (keyof S & string)[]; writes?: readonly (keyof S & string)[]; routes?: readonly Routes[]; capabilities?: readonly string[]; run: NodeHandler<S, Routes> }): NodeSpec<S, Id, Routes> {
  assertIdentifier(id, "node id"); return { id, terminal: false, reads: (options.reads ?? []).map(x => `/${x}`), writes: (options.writes ?? []).map(x => `/${x}`), handler: options.run, capabilities: options.capabilities };
}
export function terminal<S, const Id extends string>(id: Id, options: { reads?: readonly (keyof S & string)[]; writes?: readonly (keyof S & string)[]; capabilities?: readonly string[]; run: NodeHandler<S, never> }): NodeSpec<S, Id, never> { return { ...node(id, options), terminal: true }; }
export function transition<const From extends string, const Route extends string, const To extends string>(from: From, route: Route, to: To, id = `${from}.${route}.${to}`): TransitionDefinitionV1 & { readonly from: From; readonly route: Route; readonly to: To } { assertIdentifier(id, "transition id"); return { id, from, route, to }; }
export function entry<const Id extends string>(id: Id): Id { return id; }
export function limits(value: Partial<ExecutionLimitsV1> = {}): ExecutionLimitsV1 { return { max_steps: value.max_steps ?? 100, max_tokens: value.max_tokens ?? Number.MAX_SAFE_INTEGER, max_cost_micros: value.max_cost_micros ?? Number.MAX_SAFE_INTEGER, timeout_ms: value.timeout_ms ?? 30_000 }; }
export interface PackReference { readonly version: 1; readonly id: string; readonly hash?: string; readonly capabilities?: readonly string[] }
export function fromPack(id: string, options: Omit<PackReference, "version" | "id"> = {}): PackReference { assertIdentifier(id, "pack id"); return { version: 1, id, ...options }; }

type NodeIds<N extends readonly { readonly id: string }[]> = N[number]["id"];
type ValidTransition<N extends readonly NodeSpec<any, any, any>[]> = N[number] extends infer Item ? Item extends NodeSpec<any, infer Id, infer Routes> ? TransitionDefinitionV1 & { readonly from: Id; readonly route: Routes; readonly to: NodeIds<N> } : never : never;
export interface AgentDefinition<S, N extends readonly NodeSpec<S>[] = readonly NodeSpec<S>[]> { readonly graph: GraphDefinitionV1; readonly schema: TypedStateSchema<S>; readonly handlers: Readonly<Record<string, NodeHandler<S>>>; readonly capabilities: readonly string[]; readonly pack?: PackReference }
export function defineAgent<S, const N extends readonly NodeSpec<S>[]>(config: { id: string; state: TypedStateSchema<S>; nodes: N; transitions: readonly ValidTransition<N>[]; entry: NodeIds<N>; cycles?: readonly CycleDefinitionV1[]; limits?: ExecutionLimitsV1; pack?: PackReference }): AgentDefinition<S, N> {
  const handlers: Record<string, NodeHandler<S>> = {};
  for (const item of config.nodes) {
    if (item.handler) handlers[item.id] = item.handler;
  }
  const graph: GraphDefinitionV1 = { version: 1, id: config.id, state_schema: config.state.id, entry: config.entry, nodes: config.nodes.map(({ id, terminal, reads, writes }) => ({ id, terminal, reads, writes })), transitions: config.transitions, cycles: config.cycles ?? [], limits: config.limits ?? limits() };
  validateDefinition(graph); validateGraphStatePaths(graph, config.state); const capabilities = [...new Set(config.nodes.flatMap(n => n.capabilities ?? []))];
  if (config.pack?.capabilities && capabilities.some(capability => !config.pack!.capabilities!.includes(capability))) throw new DefinitionError("graph capability is not granted by pack");
  return { graph, schema: config.state, handlers, capabilities, pack: config.pack };
}
export interface CompiledAgentDefinition<S> extends AgentDefinition<S> { readonly hash: string }
export function compile<S>(definition: AgentDefinition<S>): CompiledAgentDefinition<S> { validateDefinition(definition.graph); validateGraphStatePaths(definition.graph, definition.schema); if (definition.pack?.capabilities && definition.capabilities.some(capability => !definition.pack!.capabilities!.includes(capability))) throw new DefinitionError("graph capability is not granted by pack"); return { ...definition, hash: stableHash(definition.graph) }; }
// Dependency-free SHA-256 keeps compiled hashes identical in browsers, Node, and Rust.
function stableHash(value: unknown): string {
  const text = JSON.stringify(value); const bytes = new TextEncoder().encode(text); const bitLength = bytes.length * 8; const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64; const data = new Uint8Array(paddedLength); data.set(bytes); data[bytes.length] = 0x80; const view = new DataView(data.buffer); view.setUint32(paddedLength - 4, bitLength >>> 0); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); const k = SHA256_K; const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) { for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4); for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3); const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10); w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0; } let [a,b,c,d,e,f,g,hh] = h; for (let i = 0; i < 64; i++) { const s1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25); const ch = (e! & f!) ^ (~e! & g!); const t1 = (hh! + s1 + ch + k[i]! + w[i]!) >>> 0; const s0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22); const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!); const t2 = (s0 + maj) >>> 0; hh=g; g=f; f=e; e=(d!+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; } const next = [a,b,c,d,e,f,g,hh]; for (let i=0;i<8;i++) h[i]=(h[i]!+next[i]!)>>>0; }
  return [...h].map(x => x.toString(16).padStart(8, "0")).join("");
}
const rotate = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
const SHA256_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function validateDefinition(graph: GraphDefinitionV1): void {
  assertIdentifier(graph.id, "graph id"); if (graph.version !== 1) throw new DefinitionError("unsupported graph version");
  if (!Number.isSafeInteger(graph.limits.max_steps) || graph.limits.max_steps <= 0 || !Number.isSafeInteger(graph.limits.timeout_ms) || graph.limits.timeout_ms <= 0) throw new DefinitionError("limits must be positive integers");
  const ids = new Set(graph.nodes.map(n => n.id)); if (ids.size !== graph.nodes.length) throw new DefinitionError("duplicate node id"); if (!ids.has(graph.entry)) throw new DefinitionError("entry node is not declared"); if (!graph.nodes.some(n => n.terminal)) throw new DefinitionError("at least one terminal node is required");
  const routes = new Set<string>(); const reached = new Set([graph.entry]); for (const t of graph.transitions) { if (!ids.has(t.from) || !ids.has(t.to)) throw new DefinitionError("transition endpoint is not declared"); const key = `${t.from}\0${t.route}`; if (routes.has(key)) throw new DefinitionError("duplicate route from node"); routes.add(key); }
  let changed = true; while (changed) { changed = false; for (const t of graph.transitions) if (reached.has(t.from) && !reached.has(t.to)) { reached.add(t.to); changed = true; } } if (reached.size !== ids.size) throw new DefinitionError("unreachable node");
}

/** Validate the JSON state boundary before a handler can observe or mutate it. */
export function validateState<S>(schema: TypedStateSchema<S>, value: S): void {
  for (const path of schema.required) if (readPath(value, path) === undefined) throw new DefinitionError(`missing required state path ${path}`);
  for (const [path, type] of Object.entries(schema.paths)) { const item = readPath(value, path); if (item !== undefined && valueType(item) !== type) throw new DefinitionError(`wrong state type at ${path}`); }
}
function readPath(value: unknown, path: string): unknown { return path.slice(1).split("/").reduce((current: any, key) => current == null ? undefined : current[key], value); }
function valueType(value: unknown): ValueType { if (value === null) return "Null"; if (Array.isArray(value)) return "Array"; switch (typeof value) { case "boolean": return "Bool"; case "number": return "Number"; case "string": return "String"; case "object": return "Object"; default: throw new DefinitionError("state must contain JSON values"); } }
function validateGraphStatePaths(graph: GraphDefinitionV1, schema: StateSchemaV1): void { const paths = new Set(Object.keys(schema.paths)); for (const node of graph.nodes) for (const path of [...node.reads, ...node.writes]) if (!paths.has(path)) throw new DefinitionError(`node ${node.id} references undeclared state path ${path}`); }
