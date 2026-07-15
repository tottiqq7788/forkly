#!/usr/bin/env bash
# Fail if Local API user routes are missing from docs/integrations/cli-parity.md,
# or if required coverage markers are absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="${ROOT}/docs/integrations/cli-parity.md"
SERVER="${ROOT}/internal/localapi/server.go"

if [[ ! -f "$DOC" ]]; then
  echo "missing docs/integrations/cli-parity.md" >&2
  exit 1
fi

for marker in cli_supported gui_adapted intentionally_blocked; do
  if ! grep -qF "$marker" "$DOC"; then
    echo "cli-parity.md missing status marker: $marker" >&2
    exit 1
  fi
done

if ! grep -qF "Coverage" "$DOC"; then
  echo "cli-parity.md missing Coverage section" >&2
  exit 1
fi

if [[ ! -f "$SERVER" ]]; then
  echo "missing $SERVER" >&2
  exit 1
fi

# True when cli-parity.md documents a path that covers the server route suffix
# (after /local-api/v1/). Accepts exact `/suffix`, or a documented parent written
# as `/prefix/*` / `/prefix/{id}` that owns the route.
route_documented() {
  local suffix="$1"
  if grep -qF "/${suffix}" "$DOC"; then
    return 0
  fi

  local wildcard
  while IFS= read -r wildcard; do
    [[ -z "$wildcard" ]] && continue
    # Normalize /github/device/* or /operations/{id} → github/device or operations
    local base="${wildcard#/}"
    base="${base%\*}"
    base="${base%%\{*}"
    base="${base%/}"
    [[ -z "$base" ]] && continue
    if [[ "$suffix" == "$base" || "$suffix" == "$base"/* ]]; then
      return 0
    fi
  done < <(grep -oE '/[a-zA-Z0-9_./-]+(\*|\{[a-zA-Z0-9_]+\})' "$DOC" | sort -u)

  return 1
}

missing=0
while IFS= read -r route; do
  [[ -z "$route" ]] && continue
  local_suffix="${route#/local-api/v1/}"
  local_suffix="${local_suffix%/}"
  [[ -z "$local_suffix" ]] && continue

  case "$local_suffix" in
    session|session/*|health) continue ;;
  esac

  if ! route_documented "$local_suffix"; then
    echo "cli-parity.md missing coverage for route '/${local_suffix}' (from $route)" >&2
    missing=$((missing + 1))
  fi
done < <(grep -oE '/local-api/v1/[a-zA-Z0-9_./-]+' "$SERVER" | sed 's:/*$::' | sort -u)

if [[ "$missing" -gt 0 ]]; then
  echo "cli-parity gate failed: $missing route(s) unreferenced" >&2
  exit 1
fi

echo "cli-parity check passed"
