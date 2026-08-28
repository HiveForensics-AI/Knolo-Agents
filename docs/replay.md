# Replay

Replay verifies contiguous ordered events and all artifact hashes. `verify_only`
checks history, `mocked_effects` substitutes recorded tool/retrieval results, and
`live_effects` repeats effects only with a separate authorization. Replay never
silently upgrades contracts or bypasses current policy.

TypeScript execution reports also include `state_snapshots`: the initial state
and each revision after a declared patch, bound to the event sequence that
produced it. `Agent.replayDeterministic` remains available for control-plane
compatibility; `Agent.replayDeterministicWithSnapshots` additionally compares
every recorded state revision and fails on any state divergence.
