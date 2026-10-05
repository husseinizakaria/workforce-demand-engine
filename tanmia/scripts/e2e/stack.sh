#!/usr/bin/env bash
# Local Supabase-compatible stack for end-to-end tests:
# PostgreSQL 16 + Supabase Auth (GoTrue) + PostgREST + all Edge Functions (Deno) + gateway + built frontend.
# Usage: scripts/e2e/stack.sh start | stop      (state in $E2E_DIR, default /tmp/tanmia-e2e)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${E2E_DIR:-/tmp/tanmia-e2e}"
BIN="${E2E_BIN:-$DIR/bin}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGPORT=55432; AUTH_PORT=59999; REST_PORT=53001; GATEWAY_PORT=54321; WEB_PORT=4173
SECRET="tanmia-local-e2e-jwt-secret-at-least-32-chars"
RUN=(); [[ $EUID -eq 0 ]] && RUN=(runuser -u postgres --)

stop() {
  [[ -f "$DIR/pids" ]] && while read -r p; do kill "$p" 2>/dev/null || true; done < "$DIR/pids"
  [[ -d "$DIR/data" ]] && "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -f "$DIR/pids"
}
if [[ "${1:-start}" == "stop" ]]; then stop; echo "stopped"; exit 0; fi
stop; rm -rf "$DIR/data" "$DIR/logs"; mkdir -p "$DIR/logs" "$BIN"; chmod 755 "$DIR"

# --- binaries -----------------------------------------------------------------
if [[ ! -x "$BIN/postgrest" ]]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C "$BIN"
fi
if [[ ! -x "$BIN/auth" ]]; then
  curl -sSL https://github.com/supabase/auth/releases/download/v2.170.0/auth-v2.170.0-x86.tar.gz | tar xz -C "$BIN"
fi

# --- database -----------------------------------------------------------------
id -u postgres >/dev/null 2>&1 || useradd -r postgres || true
[[ $EUID -eq 0 ]] && chown -R postgres "$DIR"
"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PGPORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/logs/pg.log" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT PGUSER=postgres
psql -qX -d postgres -c "create database tanmia" >/dev/null
psql -qX -d tanmia -v ON_ERROR_STOP=1 <<SQL >/dev/null
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole; create schema auth authorization supabase_auth_admin;
grant create on database tanmia to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
SQL
export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:$PGPORT/tanmia?sslmode=disable"
export API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" GOTRUE_SITE_URL="http://127.0.0.1:$WEB_PORT" GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:$WEB_PORT/**"
export GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_MAILER_AUTOCONFIRM=true
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false GOTRUE_SMTP_ADMIN_EMAIL=noreply@tanmia.test GOTRUE_LOG_LEVEL=warn
( cd "$BIN" && ./auth migrate >"$DIR/logs/auth-migrate.log" 2>&1 )
psql -qX -d tanmia -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do psql -qX -d tanmia -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
psql -qX -d tanmia -c "grant usage on schema auth to authenticator; notify pgrst, 'reload schema';" >/dev/null

# --- services -----------------------------------------------------------------
: > "$DIR/pids"
( cd "$BIN" && setsid nohup ./auth serve >"$DIR/logs/auth.log" 2>&1 </dev/null & echo $! >> "$DIR/pids" )
PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PGPORT/tanmia" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=$REST_PORT PGRST_SERVER_HOST=127.0.0.1 PGRST_DB_MAX_ROWS=1000 \
  setsid nohup "$BIN/postgrest" >"$DIR/logs/postgrest.log" 2>&1 </dev/null & echo $! >> "$DIR/pids"

ANON=$(node "$ROOT/scripts/e2e/jwt.mjs" anon "$SECRET"); SERVICE=$(node "$ROOT/scripts/e2e/jwt.mjs" service_role "$SECRET")
DENO="$(command -v deno || echo "npx --yes deno")"
port=55100; map="{"
for d in "$ROOT"/supabase/functions/*/; do
  name=$(basename "$d"); [[ "$name" == _shared ]] && continue; [[ -f "$d/index.ts" ]] || continue
  port=$((port+1)); map+="\"$name\":$port,"
  DENO_SERVE_ADDRESS="tcp:127.0.0.1:$port" SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" SUPABASE_ANON_KEY="$ANON" \
    SUPABASE_SERVICE_ROLE_KEY="$SERVICE" APP_URL="http://127.0.0.1:$WEB_PORT" CRON_SECRET="e2e-cron-secret" \
    setsid nohup $DENO run --config "$ROOT/supabase/functions/deno.json" --allow-net --allow-env --allow-read "$d/index.ts" >"$DIR/logs/fn-$name.log" 2>&1 </dev/null & echo $! >> "$DIR/pids"
done
map="${map%,}}"
AUTH_PORT=$AUTH_PORT REST_PORT=$REST_PORT GATEWAY_PORT=$GATEWAY_PORT FUNCTION_PORTS="$map" \
  setsid nohup node "$ROOT/scripts/e2e/proxy.mjs" >"$DIR/logs/gateway.log" 2>&1 </dev/null & echo $! >> "$DIR/pids"

# --- frontend -----------------------------------------------------------------
( cd "$ROOT" && VITE_SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" VITE_SUPABASE_ANON_KEY="$ANON" npx vite build --outDir "$DIR/dist" --emptyOutDir >"$DIR/logs/build.log" 2>&1 )
( cd "$ROOT" && setsid nohup npx vite preview --outDir "$DIR/dist" --port $WEB_PORT --host 127.0.0.1 --strictPort >"$DIR/logs/web.log" 2>&1 </dev/null & echo $! >> "$DIR/pids" )

for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health" >/dev/null && curl -sf "http://127.0.0.1:$WEB_PORT/" >/dev/null && curl -s -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" && break
  sleep 1
done
cat > "$DIR/env" <<ENV
E2E_GATEWAY=http://127.0.0.1:$GATEWAY_PORT
E2E_WEB=http://127.0.0.1:$WEB_PORT
E2E_ANON=$ANON
E2E_SERVICE=$SERVICE
E2E_PGPORT=$PGPORT
ENV
echo "stack up: web http://127.0.0.1:$WEB_PORT  gateway http://127.0.0.1:$GATEWAY_PORT  (logs: $DIR/logs)"
