import { createHarness, knoloMcpBridge } from "../../../packages/agents/dist/index.js";
import { sharedHarnessOptions, vendorSmokeEnabled } from "../shared/contracts.mjs";
import { loadVendorFixture, recordedComplete } from "../shared/recorded.mjs";
import { grokAgent } from "./grok-agent.mjs";

const live = vendorSmokeEnabled("grok");
if (live && !process.env.XAI_API_KEY) {
  console.error("KNOLO_VENDOR_SMOKE requires XAI_API_KEY");
  process.exit(1);
}

const complete = live ? liveGrokComplete(process.env.XAI_API_KEY) : recordedComplete(loadVendorFixture("grok-chat-v1.json").turns);
const session = await createHarness(sharedHarnessOptions(
  grokAgent({ complete, tools: "mcp", mcp: knoloMcpBridge() }),
  { runId: "example-grok" },
));
const { receipt, result } = await session.run();
console.log(JSON.stringify({
  adapter: "grok",
  live,
  status: result.status,
  finalStatus: receipt.finalStatus,
  toolCalls: result.toolCalls ?? [],
  dependencyRoot: receipt.harnessDependencyRoot,
}, null, 2));

function liveGrokComplete(apiKey) {
  return async request => {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? process.env.XAI_MODEL ?? "grok-4",
        messages: request.messages,
        ...(request.tools ? { tools: request.tools } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? `xai http ${response.status}`);
    return body;
  };
}
