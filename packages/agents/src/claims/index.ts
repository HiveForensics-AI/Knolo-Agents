import type { JsonValue } from "../contracts/index.js";

export interface ClaimProposalV1<O extends JsonValue = JsonValue> { readonly version: 1; readonly operation: O; readonly justification: string }
export type MutationApprovalV1 = { readonly type: "policy"; readonly decisionId: string } | { readonly type: "human"; readonly reviewer: string };
/** Injected ClaimGraph capability implemented by @knolo/core. */
export interface ClaimGraphCapability<Q extends JsonValue = JsonValue, R extends JsonValue = JsonValue> { read(query: Q): Promise<R>; commit(proposal: ClaimProposalV1): Promise<R> }
export const readClaims = <Q extends JsonValue, R extends JsonValue>(core: ClaimGraphCapability<Q, R>, query: Q): Promise<R> => core.read(query);
export const commitClaimProposal = <R extends JsonValue>(core: ClaimGraphCapability<JsonValue, R>, proposal: ClaimProposalV1, approval: MutationApprovalV1): Promise<R> => {
  if ((approval.type === "policy" && !approval.decisionId) || (approval.type === "human" && !approval.reviewer)) throw new Error("explicit ClaimGraph approval is required");
  return core.commit(proposal);
};
