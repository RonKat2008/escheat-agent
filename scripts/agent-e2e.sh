#!/usr/bin/env bash
# Runs tests/e2e/agents.spec.ts against an isolated dev server + PGlite copy (PGlite is single-process).
set -euo pipefail
cd "$(dirname "$0")/.."
export PGLITE_DATA_DIR="${PGLITE_DATA_DIR:-.data/pglite-agents}"
PORT="${E2E_PORT:-3203}"
export APP_BASE_URL="http://localhost:${PORT}"
export E2E_BASE_URL="$APP_BASE_URL"
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-agents}"
rm -rf "$PGLITE_DATA_DIR" .data/agent-artifacts
pnpm seed:demo >/dev/null
pnpm pipeline:run >/dev/null 2>&1
pnpm exec tsx scripts/ui-b-prep.ts 0
pnpm exec next dev -p "$PORT" >".data/agents-dev.log" 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null || true; wait $DEV 2>/dev/null || true' EXIT
for i in $(seq 1 90); do curl -fs "$APP_BASE_URL/replica/tx-search" >/dev/null 2>&1 && break; sleep 2; done
pnpm exec playwright test tests/e2e/agents.spec.ts "$@"
