#!/usr/bin/env bash
# Scaffold a minimal dfx project that points at knolo-agent-icp.
# Usage: init-template.sh [target-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-./knolo-icp-agent-scaffold}"

if [[ -e "$TARGET" ]]; then
  echo "Refusing to overwrite existing path: $TARGET" >&2
  exit 1
fi

mkdir -p "$TARGET/scripts" "$TARGET/fixtures"
# Relative path from TARGET to repo root (best-effort when nested under repo).
# Default: assume user copies and edits paths.
cat > "$TARGET/dfx.json" <<'EOF'
{
  "version": 1,
  "dfx": "0.20.0",
  "canisters": {
    "knolo_agent_runtime": {
      "type": "custom",
      "candid": "path/to/knolo-agents/crates/knolo-agent-icp/candid/agent_runtime.did",
      "wasm": "path/to/knolo-agents/target/wasm32-unknown-unknown/release/knolo_agent_icp.wasm",
      "build": [
        "cargo build --target wasm32-unknown-unknown --release -p knolo-agent-icp --manifest-path path/to/knolo-agents/Cargo.toml"
      ],
      "metadata": [{ "name": "candid:service" }]
    }
  }
}
EOF

cp "$ROOT/examples/icp-agent-canister/fixtures/portable-counter.definition.json" "$TARGET/fixtures/" 2>/dev/null || true
cp "$ROOT/examples/icp-agent-canister/fixtures/initial-state.json" "$TARGET/fixtures/" 2>/dev/null || true

cat > "$TARGET/README.md" <<'EOF'
# Knolo ICP agent runtime scaffold

1. Edit `dfx.json` so candid/wasm/build paths point at your knolo-agents checkout.
2. `rustup target add wasm32-unknown-unknown`
3. From knolo-agents root: `bash scripts/icp/build.sh`
4. `dfx start --background && dfx deploy`
5. Load `fixtures/portable-counter.definition.json` via `load_definition`.

See knolo-agents docs:
- `docs/architecture/adr-001-icp-agent-runtime.md`
- `docs/architecture/icp-cost-guide.md`
- `docs/architecture/icp-security-checklist.md`
- TypeScript client: `@knolo/agents` → `IcpAgentRuntimeClient`
EOF

cat > "$TARGET/scripts/run-smoke.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# After deploy + load_definition, run a deterministic execution.
STATE='{"schema_id":"counter-state","revision":0,"value":{"count":0},"provenance":null}'
dfx canister call knolo_agent_runtime start_execution '("smoke-1", '"$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$STATE")"')'
dfx canister call knolo_agent_runtime get_budget
EOF
chmod +x "$TARGET/scripts/run-smoke.sh"

echo "Scaffold written to $TARGET"
echo "Update dfx.json paths, then build and deploy."
