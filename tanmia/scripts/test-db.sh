#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL 16 cluster, emulates the Supabase auth/storage
# schemas, applies every migration in order and runs the SQL test suite
# (RBAC, two-tenant RLS isolation, storage policies, workflows, scoring).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="${TANMIA_PG_WORKDIR:-$(mktemp -d)}"; mkdir -p "$WORK"; chmod 755 "$WORK"
PORT="${TANMIA_PG_PORT:-54329}"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=tanmia_test

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; [[ -z "${KEEP_PG:-}" ]] && rm -rf "$WORK"; }
trap cleanup EXIT

RUN_AS=()
if [[ $EUID -eq 0 ]]; then
  id -u postgres >/dev/null 2>&1 || useradd -r postgres
  chown -R postgres "$WORK"; RUN_AS=(runuser -u postgres --)
fi
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
psql -q -d postgres -c "create database tanmia_test" >/dev/null

export TANMIA_ROOT="$ROOT"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
echo "▶ Supabase platform stub"; "${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "▶ migration $(basename "$f")"; "${PSQL[@]}" -f "$f" >/dev/null
done
echo "▶ health check"; "${PSQL[@]}" -f "$ROOT/supabase/health_check.sql"
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  echo "▶ test $(basename "$f")"; "${PSQL[@]}" -o /dev/null -f "$f" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'; [[ ${PIPESTATUS[0]} -eq 0 ]] || exit 1
done
echo "✔ database test suite passed"
