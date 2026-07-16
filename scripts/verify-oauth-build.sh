#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${FORKLY_GITHUB_CLIENT_ID:-}" || -z "${FORKLY_GITHUB_CLIENT_SECRET:-}" ]]; then
  echo "FORKLY_GITHUB_CLIENT_ID and FORKLY_GITHUB_CLIENT_SECRET must be set" >&2
  exit 1
fi

LDFLAGS="-X github.com/forkly-app/forkly/internal/github.ClientID=${FORKLY_GITHUB_CLIENT_ID} -X github.com/forkly-app/forkly/internal/github.ClientSecret=${FORKLY_GITHUB_CLIENT_SECRET}"
FORKLY_VERIFY_OAUTH_BUILD=1 go test -count=1 -ldflags "$LDFLAGS" ./internal/github -run TestWebOAuthConfiguredAtBuild
echo "OAuth build verification passed"
