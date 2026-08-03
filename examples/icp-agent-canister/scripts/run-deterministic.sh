#!/usr/bin/env bash
# Local dfx smoke: load pure definition, run, inspect events + checkpoint.
set -euo pipefail

export TERM="${TERM:-xterm-256color}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARGS_DIR="$(mktemp -d)"
trap 'rm -rf "$ARGS_DIR"' EXIT
export ARGS_DIR

python3 <<'PY'
import json
import os
from pathlib import Path

root = Path(".")
defn = (root / "fixtures/portable-counter.definition.json").read_text()
state = (root / "fixtures/initial-state.json").read_text()
out = Path(os.environ["ARGS_DIR"])

def candid_text(s: str) -> str:
    return json.dumps(s)

(out / "load.did").write_text(f"({candid_text(defn)})\n")
(out / "start.did").write_text(
    f"({candid_text('demo-run-1')}, {candid_text(state)})\n"
)
print("wrote candid args to", out)
PY

echo "== health =="
dfx canister call knolo_agent_runtime health

echo "== load_definition =="
dfx canister call knolo_agent_runtime load_definition --argument-file "$ARGS_DIR/load.did"

echo "== inspect =="
dfx canister call knolo_agent_runtime inspect

echo "== start_execution =="
dfx canister call knolo_agent_runtime start_execution --argument-file "$ARGS_DIR/start.did"

echo "== get_events =="
dfx canister call knolo_agent_runtime get_events '("demo-run-1")'

echo "== get_checkpoint =="
dfx canister call knolo_agent_runtime get_checkpoint '("demo-run-1")'

echo "OK: deterministic run completed"
