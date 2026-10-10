#!/usr/bin/env bash
# Database tests against a throwaway PostgreSQL — never Neon, never a remote database.
# Adapted from Robinson-AI-Systems/stripe-mcp scripts/local-postgres-test.sh @ e2f90e8 (Appliance Desk pattern).
#   npm run test:db -- tests/db/<file>.test.js
# CI: TEST_DATABASE_URL points at the job's Postgres service on 127.0.0.1. Locally: a disposable cluster is created
# from local binaries (PATH or /usr/lib/postgresql/*/bin) in a temp directory and deleted afterwards.
set -euo pipefail
export CI=1

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$TEST_DATABASE_URL")"
  case "$host" in
    localhost|127.0.0.1|::1|\[::1\]) ;;
    *) echo "Refusing TEST_DATABASE_URL on host '$host': database tests run only on localhost Postgres." >&2; exit 2 ;;
  esac
  exec npx --no-install vitest run --config vitest.db.config.js "$@"
fi

bindir=""
if ! command -v initdb >/dev/null 2>&1; then
  for dir in /usr/lib/postgresql/*/bin; do
    [[ -x "$dir/initdb" && -x "$dir/pg_ctl" ]] && bindir="$dir"
  done
  if [[ -z "$bindir" ]]; then
    echo "No local Postgres (initdb/pg_ctl) found. Push and let CI's throwaway Postgres service run the db suite." >&2
    exit 2
  fi
  export PATH="$bindir:$PATH"
fi

tmp="$(mktemp -d)"
port="$((20000 + RANDOM % 10000))"
as_pg=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb refuses to run as root; use the system postgres account for the disposable cluster.
  id postgres >/dev/null 2>&1 || { echo "Running as root without a 'postgres' user; cannot start Postgres." >&2; exit 2; }
  chown postgres "$tmp"
  as_pg=(runuser -u postgres --)
fi
cleanup() {
  "${as_pg[@]}" env PATH="$PATH" pg_ctl -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
"${as_pg[@]}" env PATH="$PATH" initdb -D "$tmp/data" -A trust -U postgres --no-instructions >/dev/null
"${as_pg[@]}" env PATH="$PATH" pg_ctl -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=127.0.0.1" -w -l "$tmp/log" start >/dev/null
export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$port/postgres"
npx --no-install vitest run --config vitest.db.config.js "$@"
