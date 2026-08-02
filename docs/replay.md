# Replay

Replay verifies contiguous ordered events and all artifact hashes. `verify_only`
checks history, `mocked_effects` substitutes recorded tool/retrieval results, and
`live_effects` repeats effects only with a separate authorization. Replay never
silently upgrades contracts or bypasses current policy.
