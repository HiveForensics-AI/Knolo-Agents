import { Agent } from "../agent/index.js";
import { defineAgent, entry, limits, node, stateSchema, terminal, transition, type StateOf } from "../builder/index.js";
import type { JsonValue } from "../contracts/index.js";
import {
  assertV5CoreAdapter,
  requireCoreCapability,
  validateCoreRetrievalResponse,
  type CoreRetrievalEvidenceV1,
  type CoreRetrievalRequestV1,
  type CoreRetrievalResponseV1,
  type KnoloCoreAdapterV1,
} from "../core/index.js";

export interface ResearchSynthesisInput {
  readonly query: string;
  readonly evidence: readonly CoreRetrievalEvidenceV1[];
  readonly receiptId: string;
  readonly artifactFingerprint: string;
}

export interface ResearchWorkflowOptions {
  readonly core: KnoloCoreAdapterV1;
  readonly request: Omit<CoreRetrievalRequestV1, "version">;
  readonly synthesize: (input: ResearchSynthesisInput) => string | Promise<string>;
  readonly executionId?: string;
}

export interface ResearchResultV1 {
  readonly version: 1;
  readonly query: string;
  readonly answer: string;
  readonly evidence_count: number;
  readonly receipt_id: string;
  readonly artifact_fingerprint: string;
}

export interface ResearchWorkflowResult {
  readonly retrieval: CoreRetrievalResponseV1;
  readonly report: Awaited<ReturnType<ReturnType<typeof buildResearchAgent>["run"]>>;
}

const researchStateSchema = stateSchema("research-state-v1", {
  query: "String",
  evidence: "Array",
  receipt_id: "String",
  artifact_fingerprint: "String",
  answer: { type: "String", optional: true },
});
type ResearchState = StateOf<typeof researchStateSchema>;

function buildResearchAgent(synthesize: ResearchWorkflowOptions["synthesize"]) {
  const synthesizeNode = node<ResearchState, "synthesize">("synthesize", {
    reads: ["query", "evidence", "receipt_id", "artifact_fingerprint"],
    writes: ["answer"],
    run: async ({ state }) => ({
      outcome: {
        type: "continue" as const,
        patch: {
          answer: await synthesize({
            query: state.query,
            evidence: state.evidence as unknown as readonly CoreRetrievalEvidenceV1[],
            receiptId: state.receipt_id,
            artifactFingerprint: state.artifact_fingerprint,
          }),
        },
      },
    }),
  });
  const completeNode = terminal<ResearchState, "complete">("complete", {
    reads: ["query", "evidence", "receipt_id", "artifact_fingerprint", "answer"],
    run: ({ state }) => ({
      outcome: {
        type: "terminate" as const,
        result: {
          version: 1,
          query: state.query,
          answer: state.answer ?? "",
          evidence_count: state.evidence.length,
          receipt_id: state.receipt_id,
          artifact_fingerprint: state.artifact_fingerprint,
        } satisfies ResearchResultV1,
      },
    }),
  });
  return Agent.load({
    definition: defineAgent({
      id: "local-research-v1",
      state: researchStateSchema,
      nodes: [synthesizeNode, completeNode],
      transitions: [transition("synthesize", "continue", "complete")],
      entry: entry("synthesize"),
      limits: limits({ max_steps: 2 }),
    }),
    engine: "typescript",
  });
}

/** Retrieve from published V5 core, then run deterministic local synthesis. */
export async function runLocalResearch(options: ResearchWorkflowOptions): Promise<ResearchWorkflowResult> {
  assertV5CoreAdapter(options.core);
  requireCoreCapability(options.core, "knowledge-image");
  requireCoreCapability(options.core, "deterministic-retrieval");
  requireCoreCapability(options.core, "query-receipts");
  if (!options.request.query.trim() || !Number.isSafeInteger(options.request.top_k) || options.request.top_k <= 0) {
    throw new Error("research query and positive integer top_k are required");
  }
  const retrieval = await options.core.retrieve({ version: 1, ...options.request });
  validateCoreRetrievalResponse(retrieval);
  const report = await buildResearchAgent(options.synthesize).run({
    query: options.request.query,
    evidence: retrieval.evidence.map((item) => ({
      content: item.content,
      score_micros: item.score_micros,
      identity: item.identity,
    })) as unknown as readonly JsonValue[],
    receipt_id: retrieval.receipt.receipt_id,
    artifact_fingerprint: retrieval.artifact.fingerprint,
  }, { executionId: options.executionId });
  return { retrieval, report };
}
