import { createHarness } from "../../../packages/agents/dist/index.js";
import { sharedHarnessOptions, vendorSmokeEnabled } from "../shared/contracts.mjs";
import { loadVendorFixture } from "../shared/recorded.mjs";
import { openClawAgent, openClawHttpFallback, openClawPlugin } from "./plugin.mjs";

const live = vendorSmokeEnabled("openclaw");
const fixture = loadVendorFixture("openclaw-end-v1.json");

if (live && process.env.OPENCLAW_URL) {
  const session = await createHarness(sharedHarnessOptions(
    openClawHttpFallback({ url: process.env.OPENCLAW_URL, fetch }),
    { runId: "example-openclaw-http" },
  ));
  const { receipt, result } = await session.run();
  console.log(JSON.stringify({ adapter: "openclaw-http", live: true, status: result.status, finalStatus: receipt.finalStatus }, null, 2));
} else {
  const plugin = openClawPlugin({ mcp: true });
  const session = await createHarness(sharedHarnessOptions(
    openClawAgent({
      plugin,
      complete: async () => fixture,
    }),
    { runId: "example-openclaw" },
  ));
  const { receipt, result } = await session.run();
  console.log(JSON.stringify({
    adapter: "openclaw",
    live: false,
    status: result.status,
    finalStatus: receipt.finalStatus,
    hooks: (result.events ?? []).map(item => item.hook),
    dependencyRoot: receipt.harnessDependencyRoot,
  }, null, 2));
}

