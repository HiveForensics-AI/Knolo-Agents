#!/usr/bin/env bash
# Load a definition JSON into the local agent runtime canister.
# Usage: load-definition.sh [path-to-definition.json]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE="$ROOT/examples/icp-agent-canister"
DEF="${1:-$EXAMPLE/fixtures/portable-counter.definition.json}"
cd "$EXAMPLE"
export TERM="${TERM:-xterm-256color}"
# Escape for candid text: pass via file + $(cat) carefully.
JSON="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$DEF")"
dfx canister call knolo_agent_runtime load_definition "($JSON)"
dfx canister call knolo_agent_runtime inspect
