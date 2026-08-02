import type { ArtifactHashesV1 } from "../replay/index.js";
import type { JsonValue } from "../contracts/index.js";
export interface HitlSuspensionV1<I extends JsonValue = JsonValue> { readonly version: 1; readonly executionId: string; readonly reason: string; readonly requestedAction: string; readonly reviewContext: JsonValue; readonly expiresAtMs: number; readonly resumeSchemaHash: string; readonly artifactHashes: ArtifactHashesV1; readonly token: string; readonly _resumeInput?: I }
export const validateResume = <I extends JsonValue>(suspension: HitlSuspensionV1<I>, input: I, schemaHash: string, now = Date.now()): I => {
  if (now >= suspension.expiresAtMs) throw new Error("stale resume token");
  if (schemaHash !== suspension.resumeSchemaHash || typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("invalid resume input");
  return input;
};
