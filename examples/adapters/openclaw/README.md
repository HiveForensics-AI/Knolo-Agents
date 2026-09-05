# OpenClaw example (L2)

Plugin hooks from the conversion plan:

- `before_prompt_build` — inject compiled Knolo context
- `before_tool_call` — deny prohibited tools; optional MCP handling
- `agent_end` — deterministic Knolo evaluation

OpenClaw plugin APIs are experimental. This example pins those three hook names
and keeps an HTTP fallback (`openClawHttpFallback` → `httpAgent`) when the host
does not expose them. Do not add an OpenClaw SDK to `@knolo/agents`.

```bash
node examples/adapters/openclaw/run.mjs
KNOLO_VENDOR_SMOKE=openclaw OPENCLAW_URL=https://host.example/run node examples/adapters/openclaw/run.mjs
```
