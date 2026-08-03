#!/usr/bin/env bash
# Deploy knolo_agent_runtime to a local dfx replica.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE="$ROOT/examples/icp-agent-canister"
cd "$ROOT"
bash "$ROOT/scripts/icp/build.sh"
cd "$EXAMPLE"
export TERM="${TERM:-xterm-256color}"
if ! dfx ping >/dev/null 2>&1; then
  echo "Starting local replica..."
  dfx start --background --clean
fi
dfx deploy knolo_agent_runtime
dfx canister call knolo_agent_runtime health
echo "Deployed. Canister id: $(dfx canister id knolo_agent_runtime)"
