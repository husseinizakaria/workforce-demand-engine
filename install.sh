#!/usr/bin/env bash
# =============================================================================
# Workforce Demand Engine — one-command server install
#
# Installs Docker, self-hosted Supabase, this app, nginx and TLS certificates
# on a fresh Ubuntu 22.04 / 24.04 server. Everything stays on this machine.
#
#   sudo bash install.sh --app workforce.example.sa \
#                        --api api.workforce.example.sa \
#                        --email you@example.sa
#
# Point BOTH domains at this server's IP before running: certificates are
# issued by proving control of the domain, so DNS has to be live first.
# =============================================================================
set -euo pipefail

APP_DOMAIN=""; API_DOMAIN=""; LE_EMAIL=""; SKIP_TLS=0
SUPABASE_REF="self-hosted/v0.8.1"
INSTALL_DIR="/opt/workforce"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)   APP_DOMAIN="$2"; shift 2 ;;
    --api)   API_DOMAIN="$2"; shift 2 ;;
    --email) LE_EMAIL="$2";   shift 2 ;;
    --skip-tls) SKIP_TLS=1;   shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
say "Checking the ground before changing anything"

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash install.sh ..."
[[ -n "$APP_DOMAIN" && -n "$API_DOMAIN" ]] || die "Both --app and --api are required."
[[ $SKIP_TLS -eq 1 || -n "$LE_EMAIL" ]] || die "--email is required for certificates (or pass --skip-tls)."
[[ -f "$REPO_DIR/supabase/schema.sql" ]] || die "Run this from inside the repository — supabase/schema.sql not found."
grep -qi 'ubuntu' /etc/os-release || warn "Not Ubuntu. Continuing, but package steps may differ."

ARCH="$(uname -m)"
if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  warn "This is an ARM server ($ARCH)."
  warn "Most Supabase images publish arm64 builds, but if any container fails to"
  warn "start with 'no matching manifest', that image has no ARM build yet and you"
  warn "need an x86_64 server instead. Everything else here is architecture-neutral."
  printf '    Continue on ARM? [y/N] '
  read -r REPLY </dev/tty || REPLY=n
  [[ "$REPLY" =~ ^[Yy]$ ]] || die "Stopped. Rebuild the server on an x86_64 (AMD or Intel) shape and run again."
fi

MEM_GB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
if [[ $MEM_GB -lt 6 ]]; then
  warn "Only ${MEM_GB} GB of RAM. The Supabase stack needs about 6 GB to run comfortably;"
  warn "below that containers get killed under load. 8 GB or more is the recommendation."
fi

MY_IP="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
if [[ -n "$MY_IP" && $SKIP_TLS -eq 0 ]]; then
  for d in "$APP_DOMAIN" "$API_DOMAIN"; do
    RESOLVED="$(getent hosts "$d" | awk '{print $1}' | head -1 || true)"
    if [[ "$RESOLVED" != "$MY_IP" ]]; then
      warn "$d resolves to '${RESOLVED:-nothing}', this server is $MY_IP"
      die "DNS is not pointing here yet. Fix the A records, wait a few minutes, run again. (Or pass --skip-tls to install without certificates.)"
    fi
    ok "$d → $MY_IP"
  done
fi

if [[ -d "$INSTALL_DIR/supabase-project" ]]; then
  die "$INSTALL_DIR/supabase-project already exists. Remove it first, or this would overwrite a running database."
fi

# ------------------------------------------------------------------- docker --
say "Installing Docker"
if command -v docker >/dev/null 2>&1; then ok "already installed"
else curl -fsSL https://get.docker.com | sh >/dev/null; ok "installed"; fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ----------------------------------------------------------------- supabase --
say "Installing Supabase ($SUPABASE_REF)"
mkdir -p "$INSTALL_DIR"; cd "$INSTALL_DIR"
[[ -d supabase ]] || git clone --depth 1 --branch "$SUPABASE_REF" https://github.com/supabase/supabase >/dev/null 2>&1
mkdir -p supabase-project
cp -rf supabase/docker/. supabase-project/
cd supabase-project
cp .env.example .env
printf 'ref=%s\n' "$SUPABASE_REF" > .supabase-version
ok "stack unpacked in $INSTALL_DIR/supabase-project"

say "Generating secrets"
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
ok "database password, JWT secret, dashboard password and API keys written to .env"

say "Setting public URLs"
SCHEME="https"; [[ $SKIP_TLS -eq 1 ]] && SCHEME="http"
set_env() {  # set_env KEY VALUE — replace in place, or append if absent
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}
set_env SUPABASE_PUBLIC_URL "${SCHEME}://${API_DOMAIN}"
set_env API_EXTERNAL_URL    "${SCHEME}://${API_DOMAIN}"
set_env SITE_URL            "${SCHEME}://${APP_DOMAIN}"
chmod 600 .env
ok "API at ${SCHEME}://${API_DOMAIN}, app at ${SCHEME}://${APP_DOMAIN}"

say "Starting Supabase (this pulls several GB the first time)"
docker compose pull >/dev/null
sh run.sh start
ok "containers up"

# -------------------------------------------------------------- the schema --
say "Waiting for Postgres"
DB_CONTAINER=""
for i in $(seq 1 60); do
  DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '(^|-)(supabase-)?db$' | head -1 || true)"
  if [[ -n "$DB_CONTAINER" ]] && docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 5
done
[[ -n "$DB_CONTAINER" ]] || die "Could not find the database container. Check: docker ps"
ok "$DB_CONTAINER is accepting connections"

say "Loading the schema and access rules"
docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$REPO_DIR/supabase/schema.sql"
ok "five tables created, row-level security on"

# ------------------------------------------------------------ the app files --
say "Configuring the app"
PUB_KEY="$(grep -E '^SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2- | tr -d '"' || true)"
[[ -n "$PUB_KEY" ]] || PUB_KEY="$(grep -E '^ANON_KEY=' .env | cut -d= -f2- | tr -d '"' || true)"
[[ -n "$PUB_KEY" ]] || die "Could not read the publishable key from .env — set it in src/config.js by hand."

cat > "$REPO_DIR/src/config.js" <<CONF
window.WDE_CONFIG = {
  backend: "supabase",
  supabaseUrl: "${SCHEME}://${API_DOMAIN}",
  supabaseKey: "${PUB_KEY}",
  environment: "Production"
};
CONF
ok "src/config.js written"

# ---------------------------------------------------------------- web serve --
say "Installing nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq nginx >/dev/null
cat > /etc/nginx/sites-available/workforce <<NGINX
server {
    listen 80;
    server_name ${APP_DOMAIN};
    root ${REPO_DIR};
    index index.html;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options        "SAMEORIGIN" always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
    location = /src/config.js { add_header Cache-Control "no-store"; }
    location / { try_files \$uri \$uri/ /index.html; }
}
server {
    listen 80;
    server_name ${API_DOMAIN};
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/workforce /etc/nginx/sites-enabled/workforce
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "nginx configuration is invalid. Run: nginx -t"
systemctl reload nginx
ok "serving $APP_DOMAIN and proxying $API_DOMAIN"

if [[ $SKIP_TLS -eq 0 ]]; then
  say "Issuing TLS certificates"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -n --agree-tos -m "$LE_EMAIL" -d "$APP_DOMAIN" -d "$API_DOMAIN" --redirect
  ok "certificates issued and auto-renewal scheduled"
fi

# ---------------------------------------------------------------- firewall --
say "Closing the database dashboard to the outside world"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw deny 8000/tcp >/dev/null 2>&1 || true
  yes | ufw enable >/dev/null 2>&1 || true
  ok "ports 22, 80, 443 open; 8000 closed"
else
  warn "ufw not present — close port 8000 in your provider's firewall by hand."
fi

# ----------------------------------------------------------------- backups --
say "Scheduling nightly backups"
mkdir -p /var/backups/workforce
cat > /etc/cron.daily/workforce-backup <<CRON
#!/bin/sh
docker exec $DB_CONTAINER pg_dump -U postgres postgres | gzip > /var/backups/workforce/wde-\$(date +%F).sql.gz
find /var/backups/workforce -name 'wde-*.sql.gz' -mtime +30 -delete
CRON
chmod +x /etc/cron.daily/workforce-backup
ok "nightly dump to /var/backups/workforce, kept 30 days"

# ------------------------------------------------------------------- done ---
DASH_USER="$(grep -E '^DASHBOARD_USERNAME=' .env | cut -d= -f2- | tr -d '"' || echo supabase)"
DASH_PASS="$(grep -E '^DASHBOARD_PASSWORD=' .env | cut -d= -f2- | tr -d '"' || echo '(see .env)')"

cat <<DONE

────────────────────────────────────────────────────────────────────────
 Installed.

 App          ${SCHEME}://${APP_DOMAIN}
 API          ${SCHEME}://${API_DOMAIN}
 Studio       ssh -L 8000:localhost:8000 $(whoami)@${MY_IP:-this-server}
              then open http://localhost:8000
 Studio login ${DASH_USER} / ${DASH_PASS}

 Secrets      ${INSTALL_DIR}/supabase-project/.env  — back this up somewhere
                                                      safe. It cannot be
                                                      regenerated.
 Next
   1. Studio → Authentication → Users → Add user  (your own account)
   2. Open the app, sign in, Clients → New client
   3. Driver library → Import / export → paste your workbook
   4. Add colleagues: see supabase/invite.sql
────────────────────────────────────────────────────────────────────────

DONE
