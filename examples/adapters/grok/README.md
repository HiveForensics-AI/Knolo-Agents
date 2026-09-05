# Grok example (L0 / L1)

Wrap a host-owned xAI chat completions client. Function-calling tools use the
same Knolo MCP names as the Grok Build example. Networking stays with the host.

```ts
const harness = await createHarness({
  agent: grokAgent({ complete, tools: "mcp", mcp: knoloMcpBridge() }),
  task,
  evidence,
  skills: { resolution: "local", packs: [ledgerReview] },
});
```

```bash
node examples/adapters/grok/run.mjs
KNOLO_VENDOR_SMOKE=grok XAI_API_KEY=... node examples/adapters/grok/run.mjs
```
