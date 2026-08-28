import { runLocalResearch, type KnoloCoreAdapterV1 } from "@knolo/agents";

// A host adapts published @knolo/core V5 here. The example uses deterministic
// local data so it can run without credentials or network access.
const core: KnoloCoreAdapterV1 = {
  descriptor: {
    version: 1,
    adapter_id: "local-v5-example",
    core_major: 5,
    core_version: "5.0.0",
    compatibility: "v5",
    capabilities: ["knowledge-image", "deterministic-retrieval", "query-receipts"],
  },
  retrieve: async () => ({
    version: 1,
    artifact: {
      version: 1,
      artifact_id: "local-handbook",
      format: "knowledge-image-v5",
      fingerprint: "sha256:local-handbook-v5",
    },
    evidence: [{
      content: "Workspace edits require explicit approval.",
      score_micros: 980000,
      identity: {
        source_id: "handbook",
        locator: "approval.md#edits",
        content_hash: "sha256:approval-rule",
        evidence_id: "evidence:approval-rule",
      },
    }],
    receipt: {
      version: 1,
      receipt_id: "receipt:local-research-1",
      plan_digest: "sha256:research-plan-1",
      result_digest: "sha256:research-result-1",
      artifact_fingerprint: "sha256:local-handbook-v5",
    },
  }),
};

const result = await runLocalResearch({
  core,
  request: { query: "What requires approval?", top_k: 3, namespace: "coding" },
  synthesize: ({ query, evidence }) => `${query} ${String(evidence[0]?.content ?? "No evidence found")}`,
});

console.log(result.report.status);
