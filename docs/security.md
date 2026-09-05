# Security model

Trust boundaries are the untrusted graph/pack, trusted policy compiler, host-owned
effect implementations, external `@knolo/core`, and checkpoint/event storage.
Validate all versioned input, deny unknown capabilities, constrain arguments and
budgets, redact events, bind resumes to artifact hashes, narrow handoffs, and keep
secrets only in host memory. Report vulnerabilities using `SECURITY.md`.

ICP canister hosts use the additional
[ICP security checklist](architecture/icp-security-checklist.md).

## Harness security checklist (1.0 freeze)

Use this before treating `@knolo/agents` harness APIs as a production trust
boundary. Native L3 (`knolo-agent` scheduler) remains the highest-assurance
mode; wrapping a weaker agent does not raise it to L3.

### Authority

- [ ] Effective authority is the intersection of parent run, agent, skill
      requirements, host capabilities, and current policy.
- [ ] Missing grants deny by default. A downloaded skill never **grants** a
      capability.
- [ ] Handoffs only narrow. Escalation (`assertNarrowAuthority`) fails closed.
- [ ] Required evidence that does not fit the context budget fails closed; it
      is never dropped silently.

### Supply chain

- [ ] Hub / registry use is optional. `skills.registry: "disabled"` never
      downloads.
- [ ] Pack bytes are SHA-256 verified against the manifest before use.
- [ ] Yanked versions fail closed (HTTP 410) unless an explicit force path is
      documented and tested.
- [ ] Registry tokens never go to Blob. Manifest GET, then **direct** Blob GET.
- [ ] Mixed `knolo.lock.json` registries fail closed without `force`.
- [ ] Offline mode is pinned cache only.
- [ ] After `HarnessDependencyRootV1` is computed, newly pulled packs stage
      for the **next** run. Mid-run hot-swap is impossible.

### Publish and secrets

- [ ] Automatic Hub publish stays disabled. Local promotion is local only.
- [ ] `publishLearnedSkill` requires usefulness, evaluation, provenance, and
      explicit approval.
- [ ] `propose-only` builds a pack and does not call Hub.
- [ ] Secrets (`sk-…`, `kno_…`, Bearer tokens, private keys) fail closed and
      never enter pack bytes.

### Evaluation and recovery

- [ ] Deterministic evaluation order is contract → artifact → task. Semantic
      judges are optional host effects and are recorded as non-deterministic.
- [ ] Policy denials fail closed and are not retried.
- [ ] Recovery is bounded (`maxRetries`). Exhausted recovery is a graceful
      partial, not an unbounded loop.

### Adapters and isolation

- [ ] `processAgent` uses explicit argv. It never spawns a hidden shell.
- [ ] `httpAgent` uses host-provided `fetch`. No implicit network client.
- [ ] Vendor SDKs stay in `examples/adapters/`, not in the published package.
- [ ] `createHarness` / context / skills / evaluation / recovery have **no**
      ICP types. Canisters are reached only through `icpAgent()`.
- [ ] Unit tests remain network-free. Live vendor smoke is env-flagged
      (`KNOLO_VENDOR_SMOKE`).

### Determinism claims

- [ ] LLM inference, external tools, and optional semantic rerank are labeled
      **external effects**. They are recorded; they are not called deterministic.
- [ ] Deterministic receipts cover pack selection, skill selection, policy
      decisions, dependency roots, and the recorded inputs/outputs of effects.
