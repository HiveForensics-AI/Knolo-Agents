# @knolo/agents

Typed agent graph builders and explicit TypeScript/WASM execution adapters. Select
an engine when calling `Agent.load`; the package never falls back to another engine.

The TypeScript engine intentionally supports only deterministic state, routing, and
suspension nodes. Use the Rust runtime or a host/WASM adapter for tool calls,
retrieval, and durable effects. `replayDeterministic` re-executes that portable
control plane and compares its ordered trace.
