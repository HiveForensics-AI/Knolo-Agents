import type { JsonValue } from "../contracts/index.js";

/** The published core major used by the adapter boundary. */
export type KnoloCoreMajor = 5 | 4;
export type CoreCompatibilityMode = "v5" | "v4-legacy";

/** Capabilities exposed by a host adapter; absence must be handled explicitly. */
export type CoreCapability =
  | "knowledge-image"
  | "verification"
  | "deterministic-retrieval"
  | "query-receipts"
  | "live-pack"
  | "cortex"
  | "claim-graph"
  | "v4-migration";

export interface CoreAdapterDescriptorV1 {
  readonly version: 1;
  readonly adapter_id: string;
  readonly core_major: KnoloCoreMajor;
  readonly core_version: string;
  readonly compatibility: CoreCompatibilityMode;
  readonly capabilities: readonly CoreCapability[];
}

export interface CoreArtifactIdentityV1 {
  readonly version: 1;
  readonly artifact_id: string;
  readonly format: "knowledge-image-v5" | "pack-v4";
  readonly fingerprint: string;
  readonly namespace?: string;
}

export interface CoreEvidenceIdentityV1 {
  readonly source_id: string;
  readonly locator: string;
  readonly content_hash: string;
  readonly evidence_id?: string;
}

export interface CoreRetrievalRequestV1 {
  readonly version: 1;
  readonly query: string;
  readonly top_k: number;
  readonly namespace?: string;
  readonly artifact_fingerprint?: string;
}

export interface CoreRetrievalEvidenceV1 {
  readonly content: JsonValue;
  readonly score_micros: number;
  readonly identity: CoreEvidenceIdentityV1;
}

export interface CoreQueryReceiptV1 {
  readonly version: 1;
  readonly receipt_id: string;
  readonly plan_digest: string;
  readonly result_digest: string;
  readonly artifact_fingerprint: string;
}

export interface CoreRetrievalResponseV1 {
  readonly version: 1;
  readonly artifact: CoreArtifactIdentityV1;
  readonly evidence: readonly CoreRetrievalEvidenceV1[];
  readonly receipt: CoreQueryReceiptV1;
}

/**
 * The only required runtime operation for the first core bridge.
 * Implementations wrap @knolo/core; they do not reimplement its storage/query
 * engine or expose core-owned bytes as agent-owned state.
 */
export interface KnoloCoreAdapterV1 {
  readonly descriptor: CoreAdapterDescriptorV1;
  retrieve(request: CoreRetrievalRequestV1): Promise<CoreRetrievalResponseV1>;
}

export class CoreAdapterError extends Error {
  readonly code: "unsupported-core-major" | "unsupported-capability" | "invalid-compatibility" | "invalid-response";

  constructor(code: CoreAdapterError["code"], message: string) {
    super(message);
    this.name = "CoreAdapterError";
    this.code = code;
  }
}

export const supportsCoreCapability = (adapter: KnoloCoreAdapterV1, capability: CoreCapability): boolean =>
  adapter.descriptor.capabilities.includes(capability);

export const requireCoreCapability = (adapter: KnoloCoreAdapterV1, capability: CoreCapability): void => {
  if (!supportsCoreCapability(adapter, capability)) {
    throw new CoreAdapterError("unsupported-capability", `core adapter does not support ${capability}`);
  }
};

/** Validate the V5 response before evidence can enter an agent run. */
export const validateCoreRetrievalResponse = (response: CoreRetrievalResponseV1): void => {
  if (response.version !== 1 || response.artifact.version !== 1 || response.artifact.format !== "knowledge-image-v5") {
    throw new CoreAdapterError("invalid-response", "core retrieval response is not a V5 Knowledge Image response");
  }
  if (!response.artifact.fingerprint || response.receipt.version !== 1 || response.receipt.artifact_fingerprint !== response.artifact.fingerprint) {
    throw new CoreAdapterError("invalid-response", "core retrieval receipt is not bound to the artifact fingerprint");
  }
  for (const evidence of response.evidence) {
    if (!evidence.identity.source_id || !evidence.identity.locator || !evidence.identity.content_hash) {
      throw new CoreAdapterError("invalid-response", "core evidence is missing stable identity");
    }
  }
};

/** Selects the expected contract deliberately; there is no silent V4 fallback. */
export const assertCoreCompatibility = (adapter: KnoloCoreAdapterV1, mode: CoreCompatibilityMode): void => {
  const expectedMajor = mode === "v5" ? 5 : 4;
  if (adapter.descriptor.core_major !== expectedMajor || adapter.descriptor.compatibility !== mode) {
    throw new CoreAdapterError(
      mode === "v5" ? "unsupported-core-major" : "invalid-compatibility",
      `expected explicit ${mode} core adapter, received ${adapter.descriptor.compatibility} ${adapter.descriptor.core_version}`,
    );
  }
};

export const assertV5CoreAdapter = (adapter: KnoloCoreAdapterV1): void => assertCoreCompatibility(adapter, "v5");

export const assertLegacyV4CoreAdapter = (adapter: KnoloCoreAdapterV1): void => {
  assertCoreCompatibility(adapter, "v4-legacy");
  requireCoreCapability(adapter, "v4-migration");
};
