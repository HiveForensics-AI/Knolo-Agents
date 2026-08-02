export type ReplayModeV1 = "verify_only" | "mocked_effects" | "live_effects";
export interface ArtifactHashesV1 { readonly graph: string; readonly pack: string; readonly policy: string; readonly nodeImplementation: string; readonly contract: string }
export interface ReplayRequestV1 { readonly version: 1; readonly mode: ReplayModeV1; readonly artifacts: ArtifactHashesV1; readonly liveEffectAuthorization?: string }
export const validateReplay = (request: ReplayRequestV1, actual: ArtifactHashesV1): void => {
  for (const key of Object.keys(actual) as (keyof ArtifactHashesV1)[]) if (request.artifacts[key] !== actual[key]) throw new Error(`incompatible ${key} hash`);
  if (request.mode === "live_effects" && !request.liveEffectAuthorization) throw new Error("live-effect replay requires explicit authorization");
};
