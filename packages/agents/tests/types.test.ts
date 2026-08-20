import { Agent, builtinAgentProfile, defineAgent, entry, node, stateSchema, terminal, transition, type AssertEngineCapabilities, type StateOf } from "../src/index.js";

const schema = stateSchema("state", { count: "Number", label: { type: "String", optional: true } });
const profile = builtinAgentProfile("coding");
profile.autonomy.maxTurns satisfies number;
type State = StateOf<typeof schema>;
const increment = node<State, "increment">("increment", { writes: ["count"], run: () => ({ outcome: { type: "continue", patch: { count: 1 } } }) });
const done = terminal<State, "done">("done", { run: () => ({ outcome: { type: "terminate", result: null } }) });

defineAgent({ id: "valid", state: schema, nodes: [increment, done], transitions: [transition("increment", "continue", "done")], entry: entry("increment") });
// @ts-expect-error transition targets must be declared nodes
defineAgent({ id: "bad-edge", state: schema, nodes: [increment, done], transitions: [transition("increment", "continue", "missing")], entry: entry("increment") });
// @ts-expect-error patches are inferred from the state schema
node<State, "bad">("bad", { run: () => ({ outcome: { type: "continue", patch: { count: "not a number" } } }) });

declare const typedAgent: Agent<State, { approved: boolean }>;
declare const checkpoint: Parameters<typeof typedAgent.resume>[0];
// @ts-expect-error resume input is an explicit generic contract
typedAgent.resume(checkpoint, { approved: "yes" });
// @ts-expect-error tools are outside the TypeScript portable subset
const unsupported: AssertEngineCapabilities<"typescript", readonly ["tools"]> = ["tools"];
