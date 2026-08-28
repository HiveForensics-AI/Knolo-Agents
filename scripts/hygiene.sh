#!/usr/bin/env bash
set -euo pipefail
tracked=$(git ls-files)
for pattern in '(^|/)(node_modules|target|dist|\.venv|coverage)(/|$)' '(^|/)(requirements[^/]*\.txt|Pipfile|poetry\.lock|pyproject\.toml|setup\.py|setup\.cfg)$' '\.(pem|key|p12|pfx)$' '(^|/)\.env($|\.)'; do
  # Prefer rg when present; fall back to grep so CI runners without ripgrep still work.
  if command -v rg >/dev/null 2>&1; then
    if printf '%s\n' "$tracked" | rg -i "$pattern"; then echo "forbidden tracked artifact" >&2; exit 1; fi
  else
    if printf '%s\n' "$tracked" | grep -Eie "$pattern"; then echo "forbidden tracked artifact" >&2; exit 1; fi
  fi
done
# Product comparisons are allowed in README prose; legacy integrations and
# credentials remain forbidden. The canonical HiveForensics-AI repository
# identity is valid release metadata and must not be treated as legacy branding.
legacy="lang"'chain|lang'"graph|lang"'smith|LANGCHAIN_API_KEY|LANGSMITH_API_KEY'
if git grep -IniE "$legacy" -- ':!scripts/hygiene.sh' ':!README.md'; then echo "forbidden legacy identity" >&2; exit 1; fi
if find . -type l -print -quit | grep -q .; then echo "symlinks require explicit review" >&2; exit 1; fi
for dir in node_modules target dist .venv coverage; do
  if find . -type d -name "$dir" -not -path './.git/*' -print -quit | grep -q .; then echo "generated directory present: $dir" >&2; exit 1; fi
done
