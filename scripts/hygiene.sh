#!/usr/bin/env bash
set -euo pipefail
tracked=$(git ls-files)
for pattern in '(^|/)(node_modules|target|dist|\.venv|coverage)(/|$)' '(^|/)(requirements[^/]*\.txt|Pipfile|poetry\.lock|pyproject\.toml|setup\.py|setup\.cfg)$' '\.(pem|key|p12|pfx)$' '(^|/)\.env($|\.)'; do
  if printf '%s\n' "$tracked" | rg -i "$pattern"; then echo "forbidden tracked artifact" >&2; exit 1; fi
done
# Product comparisons are allowed in README prose; legacy integrations,
# credentials, and source-level identity references remain forbidden.
legacy="lang"'chain|lang'"graph|lang"'smith|HiveForensics-AI|LANGCHAIN_API_KEY|LANGSMITH_API_KEY'
if git grep -IniE "$legacy" -- ':!scripts/hygiene.sh' ':!README.md'; then echo "forbidden legacy identity" >&2; exit 1; fi
if find . -type l -print -quit | grep -q .; then echo "symlinks require explicit review" >&2; exit 1; fi
for dir in node_modules target dist .venv coverage; do
  if find . -type d -name "$dir" -not -path './.git/*' -print -quit | grep -q .; then echo "generated directory present: $dir" >&2; exit 1; fi
done
