# Knolo Spawn

Knolo Spawn is the contract a parent agent calls when it delegates one task.

The parent keeps its model, its tools, and its credentials. `issueSpawn` returns an inert envelope: the task, a narrowed authority, pinned skills and knowledge roots, a budget, and a return contract. The parent, or any worker the parent chooses, runs that envelope. `closeSpawn` binds the output to a receipt.

Knolo Core is how an agent reads and verifies knowledge. Knolo Spawn is how that agent delegates one bounded task. The host still runs the model.

## What a spawn is

A spawn envelope is an artifact. It is in the same family as a pack, a root, and a receipt.

It carries:

- the parent descriptor (`id`, optional `name`, assurance level)
- `TaskV1` and its task root
- an authority projection that is a subset of the parent and the pack
- the context-envelope hash, dependency root, skill-selection receipt, and evidence receipts
- the return contract and optional expiry

It does not carry credentials, tool implementations, or a model name. Issuing a spawn does not call a model and does not start a worker.

```ts
const issued = await issueSpawn({
  parent,          // descriptor or adapter. Not invoked.
  task,
  authority,       // parent ceiling
  pack,            // pack ceiling
  evidence,
  skills,
});

const result = await parentWorker(issued.context);
const receipt = await closeSpawn(issued.envelope, result.output, {
  status: result.status,
  toolCalls: result.toolCalls,
});
```

`knolo.spawn` and `knolo.close` expose the same two steps on `knoloMcpBridge()`. The bridge must be configured with `spawnParent`, `spawnAuthority`, and `spawnPack`. Tool arguments do not choose the parent.

## What a receipt means

A passing spawn receipt means every declared check passed:

- the envelope root still matches the issued bytes
- no prohibited tool was called
- every `evaluateInvocation` check passed, including success-criteria coverage

A failed check sets `passed` to false. When the caller reports `succeeded` and a check fails, `finalStatus` is `partial`. A passing receipt does not mean the output is true. That is the same limit as a KAR `SATISFIED` result and a verified Cortex trace.

`closeSpawn` refuses the close when a tool call is on the task's prohibited list, when the envelope root does not match, when a supplied clock is past `expiryMs`, or when `status` is outside `succeeded`, `partial`, `failed`, and `suspended`.

## Authority

The issued authority is the intersection of the parent and the pack, then tightened by the task budget. A projection that adds a capability, a tool, a namespace, or a higher step or cost budget fails closed. A nested spawn uses the child envelope as the new parent ceiling, so it cannot widen the grant.

Graphs, the Rust scheduler, WASM, and the ICP canister can execute an envelope. They are workers. `accept_handoff` is one worker, not this protocol.

`handoffFromSpawn(envelope, { destination })` projects a verified envelope onto `HandoffEnvelopeV1`: destination, optional state pointers, the capability and namespace projection, the step and cost budgets, and the return contract. Spawn tool ids are not part of that handoff shape. The function checks the envelope root and returns the envelope. It does not call `accept_handoff` and it does not start a canister.

## Claim limits

- Knolo is not where you define the agent loop.
- A spawn does not discover tools.
- A spawn does not route between models.
- This is not a swarm, a marketplace, or a hosted queue.

The follow-up for the knolo.dev docs site is to replace the agents-boundary picture `Application → Knolo Agents → @knolo/core` with `Parent agent → Knolo Spawn → @knolo/core`, and to keep the model beside the host.
