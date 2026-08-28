import assert from "node:assert/strict";
import test from "node:test";
import { CoreAdapterError, runLocalResearch } from "../dist/index.js";

const adapter = {
  descriptor: {
    version: 1,
    adapter_id: "research-fixture-v5",
    core_major: 5,
    core_version: "5.0.0",
    compatibility: "v5",
    capabilities: ["knowledge-image", "deterministic-retrieval", "query-receipts"],
  },
  retrieve: async () => ({
    version: 1,
    artifact: { version: 1, artifact_id: "research-knowledge", format: "knowledge-image-v5", fingerprint: "sha256:research-v5" },
    evidence: [{ content: "Approval is required for writes.", score_micros: 990000, identity: { source_id: "policy", locator: "policy.md#write", content_hash: "sha256:approval", evidence_id: "evidence:approval" } }],
    receipt: { version: 1, receipt_id: "receipt:research-1", plan_digest: "sha256:plan-1", result_digest: "sha256:result-1", artifact_fingerprint: "sha256:research-v5" },
  }),
};

test("local research carries V5 evidence and receipt through the agent run", async () => {
  const result = await runLocalResearch({
    core: adapter,
    request: { query: "What requires approval?", top_k: 2, namespace: "coding" },
    synthesize: ({ query, evidence, receiptId }) => `${query}: ${evidence[0].content} [${receiptId}]`,
    executionId: "research-fixture",
  });
  assert.deepEqual(result.report.status, {
    type: "terminated",
    result: {
      version: 1,
      query: "What requires approval?",
      answer: "What requires approval?: Approval is required for writes. [receipt:research-1]",
      evidence_count: 1,
      receipt_id: "receipt:research-1",
      artifact_fingerprint: "sha256:research-v5",
    },
  });
  assert.equal(result.report.events.at(-1).kind.type, "terminated");
});

test("research rejects an unbound receipt", async () => {
  const invalid = { ...adapter, retrieve: async () => ({ ...(await adapter.retrieve()), receipt: { ...((await adapter.retrieve()).receipt), artifact_fingerprint: "sha256:other" } }) };
  await assert.rejects(() => runLocalResearch({ core: invalid, request: { query: "x", top_k: 1 }, synthesize: () => "never" }), CoreAdapterError);
});
