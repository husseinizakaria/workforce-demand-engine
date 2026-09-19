# Workforce Demand Engine

A workforce demand and FTE planning platform. Replaces the multi-tab FTE
calculator workbook: one driver library per client, a locked input form for
each department head, a gap dashboard for the executive, and scenario
modelling on top.

Static front end, no build step, no server-side code. Everything is plain
HTML, CSS and JavaScript — open `index.html` through any web server and it
runs.

---

## The calculation

```
Workload hours = Count × Frequency × Duration × Service hours
                 × Complexity weight × Ownership %

Required FTE   = Workload hours ÷ Annual hours per FTE
```

The denominator defaults to **1,596 hours** — 7 hours/day × 228 effective days,
after weekends, 11 public holidays and 21 days' annual leave. Complexity runs
on a 1–5 scale weighted 0.70 / 0.85 / 1.00 / 1.15 / 1.30. Both are editable per
client under **Engine settings**, and every department form inherits the change
immediately. That is the whole point of leaving the workbook: one denominator,
one rate catalogue, fifteen forms that cannot drift apart.

## Roles

| Role | Sees | Can change |
|---|---|---|
| **owner** | everything for their clients | everything, including who has access |
| **consultant** | everything for their clients | driver library, engine settings, scenarios, any department's counts |
| **exec** | every department's numbers | nothing |
| **hod** | their own department only | their own department's counts |

With the Supabase backend these are enforced in Postgres by row-level security
(`supabase/schema.sql`), not in the browser. A department head cannot read
another department's counts even by calling the API directly.

---

## Running it

### 1. Local demo — no backend

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Data is saved in that browser's local storage. On first run it loads a sample
structure — six departments, 196 required FTE against 179 filled — so the model
reads as a working system. Good for a client demo on a laptop; no accounts, no
sharing between people.

### 2. GitHub Pages

Push to `main`. The workflow in `.github/workflows/pages.yml` publishes the
site. Set **Settings → Pages → Source** to *GitHub Actions* once.

To point it at a backend, add repository variables under
**Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://your-supabase-host` |
| `SUPABASE_KEY` | the project's publishable key |
| `WDE_ENVIRONMENT` | a label, e.g. `Production` |

Both values are public client keys — every table is protected by row-level
security, so the publishable key alone grants nothing.

### 3. Your own server, data inside Saudi Arabia

This is the path for government and sovereign clients. Supabase is open
source; run it on a VM in a Saudi region (STC Cloud, Oracle Cloud Jeddah,
Alibaba Cloud Riyadh) or in AWS `me-south-1` / `me-central-1`, and no data
leaves the jurisdiction.

Point both domains at the server's IP first, then run one command on a fresh
Ubuntu 22.04 or 24.04 box:

```bash
git clone https://github.com/<your-username>/workforce-demand-engine.git
cd workforce-demand-engine
sudo bash install.sh \
  --app   workforce.example.sa \
  --api   api.workforce.example.sa \
  --email you@example.sa
```

`install.sh` installs Docker, pulls the Supabase stack, generates every
secret, sets the public URLs, loads `supabase/schema.sql`, writes
`src/config.js` with the publishable key, configures nginx for both domains,
issues Let's Encrypt certificates, closes port 8000 to the outside world and
schedules a nightly database dump. It checks DNS before touching anything and
refuses to run over an existing installation.

Add `--skip-tls` to install without certificates (behind an existing load
balancer, or on a private network).

Afterwards, back up `/opt/workforce/supabase-project/.env`. Every secret in it
is unrecoverable, and `SUPABASE_SECRET_KEY` bypasses every access rule — it
belongs on the server and nowhere else. Only the publishable key goes in
`src/config.js`.

Reach Studio over an SSH tunnel rather than exposing it:

```bash
ssh -L 8000:localhost:8000 you@your-server    # then open http://localhost:8000
```

---

## Adding people

Create the account in Supabase Studio → **Authentication → Users**, then give
it a role on a client. `supabase/invite.sql` has the statements, including the
department-head case that needs a `unit_id`.

Whoever creates a client becomes its owner automatically.

---

## Moving a workbook across

**Driver library → Import / export** takes one row per driver, pasted straight
from Excel (tab-separated) or as CSV, in this column order:

```
Department code · Department · Sub-department code · Sub-department ·
Capability · Demand driver · Unit counted · Service hours · Frequency ·
Duration · Complexity · Ownership %
```

A header row is detected and skipped. Importing replaces the whole library for
that client. Export gives the same shape back, and **Export results** gives
counts and calculated FTE per driver for the selected scenario.

Approved and filled headcount are set per department on the same page — they
drive the gap on the dashboard.

---

## Layout

```
index.html              markup and script tags
assets/styles.css       design tokens, light and dark
src/config.js           per-deployment settings — the only file that changes
src/engine.js           constants, the FTE calculation, sample structure
src/storage.js          storage adapters: claude · supabase · local
src/app.js              state, views, boot
install.sh              one-command server install (Docker, Supabase, nginx, TLS)
supabase/schema.sql     tables, roles, row-level security
supabase/invite.sql     adding people to a client
deploy/                 docker-compose and nginx for self-hosting
```

### Swapping the backend

The app never touches a database directly. It calls `Store`, which delegates to
an adapter — eleven methods, all `async`:

```
listTenants()                 loadTenant(t)        loadCounts(t, s)
putTenant(t)                  putUnit(t, u)        putScenario(t, s)
putCounts(t, s, u, body)      delTenant(t)         delUnit(t, u)
delScenario(t, s)             copyCounts(t, from, to)
```

Implement those against anything — a Node API, SQL Server, a SharePoint list —
and register it in `Store.init()`. Nothing else in the application changes.
