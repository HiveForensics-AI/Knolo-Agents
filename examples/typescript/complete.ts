import {
  Agent, assertNarrowAuthority, commitClaimProposal, compile, cortexContext,
  defineAgent, entry, fromPack, limits, node, stateSchema, terminal, transition,
  validateReplay, validateResume,
  type ArtifactHashesV1, type ClaimGraphCapability, type CortexCapability,
  type CheckpointV1, type HitlSuspensionV1, type RetrievalResultV1, type WasmProtocolAdapter,
} from "@knolo/agents";

const state = stateSchema("examples.basic.v1", {
  question: "String", context: "Array", answer: { type: "String", optional: true },
});
type State = import("@knolo/agents").StateOf<typeof state>;
const retrieve = node<State, "retrieve", "continue">("retrieve", {
  reads: ["question"], writes: ["context"], capabilities: ["retrieval.query"],
  run: ({ state }) => ({ outcome: { type: "continue", patch: { context: [{ source: "handbook", text: state.question }] } } }),
});
const answer = terminal<State, "answer">("answer", {
  reads: ["question", "context"], writes: ["answer"],
  run: ({ state }) => ({ outcome: { type: "terminate", result: { answer: state.question }, patch: { answer: state.question } } }),
});
const definition = compile(defineAgent({ id: "examples.basic", state, nodes: [retrieve, answer], transitions: [transition("retrieve", "continue", "answer")], entry: entry("retrieve"), limits: limits({ max_steps: 2 }), pack: fromPack("examples.retrieval") }));
const report = await Agent.load({ definition, engine: "typescript" }).run({ question: "What is Knolo?", context: [] });

// Tools are host implementations and must be authorized by the pack before invocation.
const calculator = { id: "calculator.add", arguments: { a: 2, b: 3 } };
if (calculator.id !== "calculator.add") throw new Error("tool denied");

const evidence: RetrievalResultV1 = { version: 1, evidence: [{ content: { text: "Explicit context" }, score_micros: 1_000_000, provenance: { source_id: "local", locator: "line:1", content_hash: "sha256:fixture" } }] };
const cortex: CortexCapability = { query: async request => request, context: async () => evidence as never };
await cortexContext(cortex, { query: "Knolo" });
const claims: ClaimGraphCapability = { read: async query => query, commit: async proposal => proposal.operation };
await commitClaimProposal(claims, { version: 1, operation: { add: "claim" }, justification: "supported by local evidence" }, { type: "human", reviewer: "reviewer@example.test" });

const parent = { capabilities: ["retrieval.query", "claims.read"], namespaces: ["local"], maxSteps: 10, maxCostMicros: 100 };
assertNarrowAuthority({ capabilities: ["claims.read"], namespaces: ["local"], maxSteps: 2, maxCostMicros: 10 }, parent, parent);
const hashes: ArtifactHashesV1 = { graph: definition.hash, pack: "pack", policy: "policy", nodeImplementation: "nodes", contract: "v1" };
validateReplay({ version: 1, mode: "mocked_effects", artifacts: hashes }, hashes);
const suspension: HitlSuspensionV1<{ approved: boolean }> = { version: 1, executionId: "example-1", reason: "approval", requestedAction: "claims.commit", reviewContext: {}, expiresAtMs: Date.now() + 60_000, resumeSchemaHash: "approval-v1", artifactHashes: hashes, token: "opaque" };
validateResume(suspension, { approved: true }, "approval-v1");
const checkpoint: CheckpointV1 = { version: 1, execution_id: "example-1", graph_hash: definition.hash, pack_hash: "pack", policy_hash: "policy", node_implementation_hash: "nodes", contract_hash: "v1", state: report.state, pending_node: "answer", event_cursor: report.events.length, steps: 1, tokens: 0, cost_micros: 0 };
// A real suspended run returns this checkpoint; resume validates it before continuing.
const resume = (input: { approved: boolean }) => Agent.load<State, { approved: boolean }>({ definition, engine: "typescript" }).resume(checkpoint, input);
void resume;
Agent.load({ definition, engine: "typescript" }).replay(report.events);
const wasm: WasmProtocolAdapter = { command: async () => JSON.stringify([]) };
const wasmInspection = Agent.load({ definition, engine: "wasm", wasm }).inspect();
console.log({ report: report.status.type, evidence: evidence.evidence.length, wasm: wasmInspection.engine });
