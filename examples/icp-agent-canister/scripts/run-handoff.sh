#!/usr/bin/env bash
# Accept a multi-agent handoff into the portable-counter definition (local dfx).
# Prerequisites: definition loaded (run-deterministic.sh or load_definition).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXAMPLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$EXAMPLE"
export TERM="${TERM:-xterm-256color}"

ENV_JSON="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$EXAMPLE/fixtures/handoff.envelope.json")"
STATE_JSON="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$EXAMPLE/fixtures/initial-state.json")"
AUTH_JSON="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$EXAMPLE/fixtures/handoff-parent.authority.json")"

dfx canister call knolo_agent_runtime accept_handoff \
  "(\"handoff-demo-1\", $ENV_JSON, $STATE_JSON, $AUTH_JSON)"
dfx canister call knolo_agent_runtime get_events '("handoff-demo-1")'
dfx canister call knolo_agent_runtime get_store_stats
echo "Handoff smoke complete."
