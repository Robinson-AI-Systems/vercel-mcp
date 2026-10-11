#!/usr/bin/env bash
# Run the emulate suite against Vercel Labs' `emulate` (a local Vercel REST API emulator; no network, no real team).
#   npm run test:emulate -- tests/emulate/<file>.test.js
# Starts the pinned emulator (package.json devDependency, locked in package-lock.json) on 127.0.0.1, waits at most
# 30 s for GET /v2/user, runs the given vitest files with VERCEL_API_BASE pointing at it, and always stops it on exit.
set -euo pipefail
export CI=1
PINNED="0.12.1"
PORT="${EMULATE_PORT:-4000}"
BIN="node_modules/emulate/dist/index.js"

installed="$(node -p "require('./node_modules/emulate/package.json').version" 2>/dev/null || true)"
if [[ "$installed" != "$PINNED" ]]; then
  echo "emulate $PINNED is not installed (found '${installed:-none}'). Run npm ci." >&2
  exit 2
fi
if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
  echo "Port $PORT is already in use; set EMULATE_PORT to a free port." >&2
  exit 2
fi

log="$(mktemp)"
node "$BIN" start --service vercel --seed test/fixtures/vercel-emulate.yaml --port "$PORT" --host 127.0.0.1 >"$log" 2>&1 &
pid=$!
cleanup() {
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  rm -f "$log"
}
trap cleanup EXIT

ready=""
for _ in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 2 -H 'Authorization: Bearer vcp_FAKEemulateToken' \
    "http://127.0.0.1:$PORT/v2/user" || true)"
  if [[ "$code" == "200" ]]; then ready=1; break; fi
  sleep 1
done
if [[ -z "$ready" ]]; then
  echo "emulate did not answer GET /v2/user within 30 s. Its output:" >&2
  tail -20 "$log" >&2
  exit 1
fi

export VERCEL_API_BASE="http://127.0.0.1:$PORT"
npx --no-install vitest run --config vitest.emulate.config.js "$@"
