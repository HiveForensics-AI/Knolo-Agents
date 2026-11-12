import { vendorSmokeEnabled } from "../shared/contracts.mjs";
import { loadVendorFixture, recordedComplete } from "../shared/recorded.mjs";
import { runGrokBuildParent } from "./grok-build-agent.mjs";

const live = vendorSmokeEnabled("grok-build") || vendorSmokeEnabled("grok");
if (live && !process.env.XAI_API_KEY) {
  console.error("KNOLO_VENDOR_SMOKE requires XAI_API_KEY for a live Grok Build session");
  process.exit(1);
}

const complete = live ? liveGrokBuildComplete(process.env.XAI_API_KEY) : recordedComplete(loadVendorFixture("grok-chat-v1.json").turns);
const { issued, result, receipt } = await runGrokBuildParent(complete);
console.log(JSON.stringify({
  adapter: "grok-build",
  live,
  status: result.status,
  finalStatus: receipt.finalStatus,
  passed: receipt.evaluation.passed,
  toolCalls: result.toolCalls ?? [],
  envelopeRoot: issued.envelope.envelopeRoot,
  dependencyRoot: issued.envelope.dependencyRoot,
}, null, 2));

function liveGrokBuildComplete(apiKey) {
  return async request => {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? process.env.XAI_MODEL ?? "grok-4.6",
        messages: request.messages,
        ...(request.tools ? { tools: request.tools } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? `xai http ${response.status}`);
    return body;
  };
}
