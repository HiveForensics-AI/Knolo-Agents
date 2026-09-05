/** Optional `@knolo/core` ^5.1.0 loader. Harness code fails closed when Core is absent. */

export const CORE_V5_PEER = "^5.1.0";
export const CORE_ABSENT_MESSAGE = `Core V5 is required for this adapter; install @knolo/core@${CORE_V5_PEER}`;

/** Structural subset of `@knolo/core` used by Agents adapters. */
export interface CoreV5Module {
  readonly createKnowledgeImageV5: (...args: never[]) => unknown;
  readonly verifyKnowledgeImageV5: (...args: never[]) => unknown;
  readonly mountKnowledgeImageV5: (...args: never[]) => unknown;
  readonly inspectKnowledgeImageV5: (...args: never[]) => unknown;
  readonly queryKnowledgeImageV5: (...args: never[]) => unknown;
  readonly parseKnowledgeQueryV5: (...args: never[]) => unknown;
  readonly createCortex: (...args: never[]) => unknown;
  readonly remember: (...args: never[]) => unknown;
  readonly recall: (...args: never[]) => unknown;
  readonly getClaimGraph: (...args: never[]) => unknown;
  readonly buildClaimGraph: (...args: never[]) => unknown;
  readonly createKnowledgeRunV1: (...args: never[]) => unknown;
  readonly startKnowledgeRunV1: (...args: never[]) => unknown;
  readonly checkpointKnowledgeRunV1: (...args: never[]) => unknown;
  readonly completeKnowledgeRunV1: (...args: never[]) => unknown;
  readonly failKnowledgeRunV1: (...args: never[]) => unknown;
  readonly canonicalCbor: (...args: never[]) => unknown;
  readonly digestBytes: (...args: never[]) => unknown;
  readonly queryWithReceipt: (...args: never[]) => unknown;
  readonly verifyReceipt: (...args: never[]) => unknown;
  readonly verifyKnowledgeAuthorityEnvelopeV5: (...args: never[]) => unknown;
  readonly inspectKnowledgeRuntimeV5: (...args: never[]) => unknown;
}

export function requireCoreV5<T>(core: T | null | undefined, message = CORE_ABSENT_MESSAGE): T {
  if (core == null) throw new Error(message);
  return core;
}

export async function loadCoreV5(): Promise<CoreV5Module> {
  try {
    return (await import("@knolo/core")) as unknown as CoreV5Module;
  } catch {
    throw new Error(CORE_ABSENT_MESSAGE);
  }
}
