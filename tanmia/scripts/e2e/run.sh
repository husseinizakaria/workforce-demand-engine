#!/usr/bin/env bash
# Starts the local stack, seeds the platform owner and runs the Playwright E2E suite.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${E2E_DIR:-/tmp/tanmia-e2e}"
bash "$ROOT/scripts/e2e/stack.sh" start
trap 'bash "$ROOT/scripts/e2e/stack.sh" stop >/dev/null' EXIT
set -a; source "$DIR/env"; set +a
for i in $(seq 1 30); do curl -sf "$E2E_GATEWAY/auth/v1/health" >/dev/null && break; sleep 1; done
curl -s -X POST "$E2E_GATEWAY/auth/v1/admin/users" -H "apikey: $E2E_SERVICE" -H "Authorization: Bearer $E2E_SERVICE" -H 'content-type: application/json' \
  -d '{"email":"owner@tanmia.test","password":"E2e-Passw0rd-2026","email_confirm":true,"user_metadata":{"full_name":"Platform Owner"}}' >/dev/null
PGHOST=127.0.0.1 PGPORT=$E2E_PGPORT psql -U postgres -d tanmia -qtAc "select public.promote_platform_super_admin('owner@tanmia.test')" >/dev/null
cd "$ROOT" && npx playwright test -c tests/e2e/playwright.config.ts "$@"
