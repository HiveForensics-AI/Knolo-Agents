import { wrapIcpCanister } from "./harness-wrap.mjs";

const actor = {
  inspect: async () => ({
    ok: true,
    engine: "icp",
    graph_loaded: true,
    graph_id: [],
    graph_hash: [],
    implementation_id: [],
    execution_count: 0n,
    capabilities: [],
    limitations: ["example fake actor"],
    message: "ok",
    schema_version: 1,
    handoff_count: 0n,
  }),
  start_execution: async (executionId, initialStateJson) => ({
    ok: true,
    execution_id: executionId,
    status: { kind: "terminated", detail: "done" },
    steps: 1n,
    tokens: 0n,
    cost_micros: 0n,
    state_json: JSON.stringify({
      output: "identify suspicious transactions and cite supporting evidence; do not perform irreversible actions",
    }),
    event_count: 1n,
    message: initialStateJson ? "ok" : "ok",
  }),
  resume: async executionId => ({
    ok: true,
    execution_id: executionId,
    status: { kind: "terminated", detail: "resumed" },
    steps: 1n,
    tokens: 0n,
    cost_micros: 0n,
    state_json: "{\"resumed\":true}",
    event_count: 1n,
    message: "ok",
  }),
};

const session = await wrapIcpCanister(actor, { runId: "example-icp-wrap" });
const { receipt, result } = await session.run();
console.log(JSON.stringify({
  adapter: "icp",
  status: result.status,
  finalStatus: receipt.finalStatus,
  level: "platform",
  dependencyRoot: receipt.harnessDependencyRoot,
}, null, 2));
