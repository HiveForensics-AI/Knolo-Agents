# Grok Build example (parent agent)

Grok Build stays the parent. Knolo issues a spawn envelope, the host-owned
session answers from that brief, and Knolo closes the envelope into a receipt.
Grok Build is not a dependency of `@knolo/agents`. The recorded fixture never
calls the network.

```ts
const agent = grokBuildAgent({ complete, tools: "mcp", mcp: knoloMcpBridge() });
const issued = await issueSpawn({
  parent: agent,
  task,
  authority,
  pack,
  evidence,
  skills: { resolution: "local", packs: [ledgerReview] },
});
const result = await agent.invoke(undefined, {
  runId: "example-grok-build",
  task: issued.envelope.task,
  envelope: issued.context,
});
const receipt = await closeSpawn(issued.envelope, result.output, {
  status: result.status,
  toolCalls: result.toolCalls,
});
```

`issueSpawn` does not call `complete()`. The parent does. Default `run.mjs`
uses a recorded Grok Build turn. Live smoke:

```bash
node examples/adapters/grok-build/run.mjs
KNOLO_VENDOR_SMOKE=grok-build XAI_API_KEY=... node examples/adapters/grok-build/run.mjs
```
