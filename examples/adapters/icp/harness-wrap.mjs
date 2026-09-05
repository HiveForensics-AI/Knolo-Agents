import { createHarness, icpAgent } from "../../../packages/agents/dist/index.js";
import { sharedHarnessOptions } from "../shared/contracts.mjs";

/**
 * ICP is a platform adapter, not harness core.
 * The canister host stays in knolo-agent-icp; TypeScript reaches it only here.
 */
export function wrapIcpCanister(actor, extra = {}) {
  return createHarness(sharedHarnessOptions(icpAgent({ actor }), extra));
}
