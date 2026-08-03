#!/usr/bin/env bash
# Build the Knolo agent runtime canister Wasm (release).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release
WASM="target/wasm32-unknown-unknown/release/knolo_agent_icp.wasm"
BYTES="$(wc -c < "$WASM" | tr -d ' ')"
echo "Built $WASM ($BYTES bytes)"
