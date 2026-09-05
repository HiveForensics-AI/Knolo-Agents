# ICP harness wrap

ICP is a **platform adapter**, not harness core. The canister host remains
`knolo-agent-icp`. TypeScript reaches it only through `icpAgent()`:

```ts
const harness = await createHarness({
  agent: icpAgent({ actor }),
  task,
});
```

See [`examples/icp-agent-canister/`](../../icp-agent-canister/) for the dfx host.
`run.mjs` uses a fake actor so the wrap stays network-free.
