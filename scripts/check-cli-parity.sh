#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="${ROOT}/docs/integrations/cli-parity.md"

if [[ ! -f "$DOC" ]]; then
  echo "missing docs/integrations/cli-parity.md" >&2
  exit 1
fi

for marker in cli_supported gui_adapted intentionally_blocked; do
  if ! grep -q "$marker" "$DOC"; then
    echo "cli-parity.md missing status marker: $marker" >&2
    exit 1
  fi
done

if ! grep -q "Coverage" "$DOC"; then
  echo "cli-parity.md missing Coverage section" >&2
  exit 1
fi

echo "cli-parity check passed"
