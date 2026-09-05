# Grok Build example (L0 / L1)

Wrap a **host-owned Grok Build session**. Knolo compiles the task, evidence, and
local skills; Grok Build never becomes a dependency of `@knolo/agents`. This
replaces the Claude example: the same Task / Context / Skill / Registry
contracts, with Grok Build as the vendor session.

```ts
const harness = await createHarness({
  agent: grokBuildAgent({ complete, tools: "mcp", mcp: knoloMcpBridge() }),
  task,
  evidence,
  skills: { resolution: "local", packs: [ledgerReview] },
  authority: { capabilities: ["ledger.read"] },
});
```

Default `run.mjs` uses a recorded Grok Build turn. Live smoke:

```bash
node examples/adapters/grok-build/run.mjs
KNOLO_VENDOR_SMOKE=grok-build XAI_API_KEY=... node examples/adapters/grok-build/run.mjs
```
