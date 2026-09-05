# Vendor adapter examples

Thin Grok Build, Grok, and OpenClaw wrappers around the same harness contracts.
Vendor SDKs are **not** dependencies of `@knolo/agents`. Each example injects a
host-owned `complete()` (or `fetch`) and reuses `TaskV1`, compiled context,
local skills, and the optional registry policy.

| Path | Level | Host surface |
| --- | --- | --- |
| [grok-build/](grok-build/) | L0 / L1 | Host-owned Grok Build session; optional Knolo MCP tools |
| [grok/](grok/) | L0 / L1 | Host xAI chat completions + function calling |
| [openclaw/](openclaw/) | L2 | Plugin hooks `before_prompt_build`, `before_tool_call`, `agent_end`; HTTP fallback |
| [icp/](icp/) | platform | `createHarness({ agent: icpAgent({ actor }) })` only |

Generic MCP (`knolo.retrieve`, `knolo.resolve_skills`, `knolo.evaluate`) lives in
`@knolo/agents` as `knoloMcpBridge()`. Recorded fixtures under
`contracts/fixtures/harness/vendors/` keep the default run offline.

```bash
pnpm --filter @knolo/agents build
node examples/adapters/grok-build/run.mjs
node examples/adapters/grok/run.mjs
node examples/adapters/openclaw/run.mjs
node examples/adapters/icp/run.mjs
```

Live vendor smoke is opt-in and never part of the default unit suite:

```bash
KNOLO_VENDOR_SMOKE=grok-build XAI_API_KEY=... node examples/adapters/grok-build/run.mjs
KNOLO_VENDOR_SMOKE=grok XAI_API_KEY=... node examples/adapters/grok/run.mjs
KNOLO_VENDOR_SMOKE=openclaw OPENCLAW_URL=https://... node examples/adapters/openclaw/run.mjs
```
