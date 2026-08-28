import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLegacyV4CoreAdapter,
  assertV5CoreAdapter,
  CoreAdapterError,
  requireCoreCapability,
  supportsCoreCapability,
} from "../dist/index.js";

const v5Adapter = {
  descriptor: {
    version: 1,
    adapter_id: "fixture-v5",
    core_major: 5,
    core_version: "5.0.0",
    compatibility: "v5",
    capabilities: ["knowledge-image", "verification", "deterministic-retrieval", "query-receipts", "cortex", "claim-graph"],
  },
  retrieve: async (request) => ({
    version: 1,
    artifact: { version: 1, artifact_id: "coding-knowledge", format: "knowledge-image-v5", fingerprint: "sha256:coding-knowledge-v5", namespace: request.namespace },
    evidence: [{ content: "approved", score_micros: 940000, identity: { source_id: "policy-guide", locator: "policy.md#approval", content_hash: "sha256:policy-approval", evidence_id: "evidence:policy-approval" } }],
    receipt: { version: 1, receipt_id: "receipt:coding-query-1", plan_digest: "sha256:plan-coding-query-1", result_digest: "sha256:result-coding-query-1", artifact_fingerprint: "sha256:coding-knowledge-v5" },
  }),
};

test("V5 adapter preserves evidence identity and query receipts", async () => {
  assertV5CoreAdapter(v5Adapter);
  assert.equal(supportsCoreCapability(v5Adapter, "query-receipts"), true);
  const response = await v5Adapter.retrieve({ version: 1, query: "approved workspace edit", top_k: 2, namespace: "coding" });
  assert.equal(response.artifact.format, "knowledge-image-v5");
  assert.equal(response.evidence[0].identity.content_hash, "sha256:policy-approval");
  assert.equal(response.receipt.artifact_fingerprint, response.artifact.fingerprint);
});

test("V5 selection fails closed for a legacy V4 adapter", () => {
  const legacy = { ...v5Adapter, descriptor: { ...v5Adapter.descriptor, core_major: 4, core_version: "4.0.0", compatibility: "v4-legacy", capabilities: ["v4-migration"] } };
  assert.throws(() => assertV5CoreAdapter(legacy), CoreAdapterError);
  assertLegacyV4CoreAdapter(legacy);
  assert.throws(() => requireCoreCapability(legacy, "query-receipts"), /does not support query-receipts/);
});
