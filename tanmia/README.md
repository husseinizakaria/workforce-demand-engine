# نماء · TANMIA

Arabic-first (RTL) / English (LTR) platform for program management, beneficiary
development, assessment, evidence, reporting and social-impact measurement.
React 19 + TypeScript + Vite frontend (deployed to Hostinger), Supabase backend
(PostgreSQL, Auth, RLS, Storage, Edge Functions).

The platform behaves as an expert system: a shared analysis engine
(`supabase/functions/_shared/engine`) runs both in the browser and in Edge
Functions to detect missing setup, blockers, evidence gaps, KPI anomalies and
conflicts, interpret assessments and maturity change, rank experts explainably,
and draft reports — always as recommendations with rationale and source data.
It never presents a pre/post difference as causal impact: every outcome/impact
claim is classified as *observed change*, *contribution* or *stronger causal
evidence* (comparison designs with difference-in-differences).

## Repository layout

```
src/                         React app (see docs/DEVELOPMENT.md)
  app/ routes/ layouts/      providers, routing rules, shells (right-side Arabic nav)
  features/<module>/         platform-admin, dashboard, programs (+ workspace), beneficiaries, experts,
                             vendors, partners, operations, assessments, evidence, outcomes, impact,
                             templates, reports, governance, notifications, ai
  components/ services/ hooks/ i18n/ types/ utils/ styles/
supabase/
  migrations/                canonical schema (apply in order) — 0800 is generated reference data
  functions/                 16 Edge Functions + _shared (auth, validation, audit, LLM, engine)
  health_check.sql           post-install database health check
  tests/                     local Postgres test-suite (RLS / RBAC / workflows / scoring)
public/.htaccess             Hostinger SPA rewrite + security headers (copied into dist/)
scripts/                     test-db.sh, verify-build.mjs, generate-reference-seed.ts
tests/                       Vitest unit tests (engine, routing rules, seed sync)
docs/                        EDGE_FUNCTIONS.md, DEVELOPMENT.md, BACKEND_VERIFICATION.md, DEPLOYMENT_HOSTINGER.md
```

## Requirements

Node.js ≥ 20 (22 recommended), npm, the Supabase CLI (`npx supabase`), a Supabase
project (region `me-central-1` or a Saudi-resident self-hosted deployment for data residency).

## 1. Install the backend (Supabase)

```bash
npm install
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push                       # applies supabase/migrations/* in order
```

Alternatively paste each file of `supabase/migrations/` into the SQL editor **in filename order**.
Do not apply the legacy `000_full_install.sql` from the previous package — this schema replaces it
(see "Changes from the previous package" below).

Then run `supabase/health_check.sql` in the SQL editor — every row must be `PASS`
(`platform_owner_configured` stays `WARN` until step 2).

### 2. Create the Platform Super Admin

1. Supabase → Authentication → Users → *Add user* (email + password, auto-confirm).
2. SQL editor: `select public.promote_platform_super_admin('owner@your-domain.sa');`

There is no self-service "claim ownership" button: only someone with database access can
designate the platform owner. The owner signs in and lands directly on `/platform` — no
invitation code and no organization required. Additional owners can be created from
Platform → Users.

### 3. Auth settings

Authentication → URL configuration: *Site URL* = `https://app.your-domain.sa`; add
`https://app.your-domain.sa/reset-password` and `https://app.your-domain.sa/invite/*` to the
redirect allow-list. Disable public sign-ups if you only onboard by invitation
(invited users can still create their account from the invitation link when sign-ups are enabled;
with sign-ups disabled, create users from Platform → Users or Governance → Users).
Configure SMTP (Authentication → SMTP) so password-reset and confirmation emails are delivered.

### 4. Deploy the Edge Functions

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill in values
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy                                 # deploys all 16 functions
```

| Secret | Required | Purpose |
|---|---|---|
| `APP_URL` | yes | public URL used in invitation / calendar links |
| `CRON_SECRET` | yes | protects scheduled `dispatch-notification` and `program-health-check` calls |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | optional | LLM narratives, interpretation, translation (`AI_MODEL` defaults to `claude-opus-5-5`). Without it every AI feature still works from the rules engine and says so (`generated_by: rules`). |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | email notifications / invitations (otherwise links are shown once to the admin) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM` | optional | SMS / WhatsApp |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase
into Edge Functions automatically. **The service-role key never goes into the frontend.**

Schedule the background jobs (Supabase → Integrations → Cron, or any scheduler):

```sql
select cron.schedule('tanmia-dispatch', '*/5 * * * *', $$
  select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/dispatch-notification',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'content-type', 'application/json'), body := '{}'::jsonb) $$);
select cron.schedule('tanmia-health', '15 2 * * *', $$
  select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/program-health-check',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'content-type', 'application/json'), body := '{}'::jsonb) $$);
```

## 5. Build and deploy the frontend (Hostinger)

```bash
cp .env.example .env          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (anon/publishable key only)
npm run build                 # tsc + vite build → dist/
npm run verify:build          # checks .htaccess, scans the bundle for leaked secrets
```

Upload the **contents** of `dist/` (including the hidden `.htaccess`) to `public_html/`
(or the sub-domain's document root) with Hostinger File Manager or FTP. Details:
`docs/DEPLOYMENT_HOSTINGER.md`. Environment variables are compiled in at build time —
rebuild after changing them. A build without them shows a "Platform not configured" screen;
a build containing a service-role key refuses to start.

## Local development

```bash
npm run dev          # http://localhost:5173 against your Supabase project
npm test             # engine + routing unit tests (Vitest)
npm run test:db      # throwaway PostgreSQL 16: migrations + health check + RLS/RBAC/workflow suite
npm run typecheck
npm run test:e2e     # local Supabase-compatible stack (PostgreSQL + Supabase Auth + PostgREST + all Edge
                     # Functions) and a Playwright browser suite: login, session restore, owner routing,
                     # organization creation, invitation acceptance, program creation + journey, two-tenant
                     # isolation, organization selector, no-access state, RTL/LTR, function authorization
```

`npm run test:db` needs the PostgreSQL 16 server binaries (`apt install postgresql-16`). It emulates
the Supabase `auth`/`storage` schemas and API roles, applies every migration, runs
`health_check.sql` and the assertions in `supabase/tests/` (two-tenant isolation, RBAC, module
deactivation, self-service access, journey gates and approvals, scheduling conflicts,
assessment-scoring parity with the TypeScript engine, maturity, evidence verification,
organization-scoped storage, audit immutability). Edge Functions are type-checked with
`npx deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`.

## Authentication routing (implemented in `src/routes/resolveHome.ts`, tested in `tests/routing.test.ts`)

1. Session restored by supabase-js → `my_access()` RPC loads platform status, memberships, roles, permissions, modules.
2. Unauthenticated → `/login`.
3. `is_platform_super_admin` → `/platform` (no invitation, no organization).
4. One active membership → `/app/dashboard` in that organization.
5. Several → `/select-organization` (after sign-in; a page reload keeps the previous choice).
6. None → `/no-access` with the precise reason (no membership / deactivated / organization suspended).
7. Invitations are accepted at `/invite/:token` — a separate workflow that never replaces login.

## Security model

* Tenant isolation by RLS on every table: `tenant_can(organization_id, module, action)` = platform
  owner, or active member of an active organization whose module is enabled and whose roles grant
  `<module>.<action>`. Users may hold several roles; permissions are aggregated.
* `tg_tenant_guard` on every tenant table makes `organization_id` immutable and rejects references
  to records of another organization (e.g. enrolling another tenant's beneficiary).
* Beneficiaries and experts get self-service access to their own records only.
* Storage paths are `<organization_id>/…` in private buckets; storage policies authorize by that segment.
* Workflow gates are enforced in the database: stage dependencies / required evidence / approvals
  (`transition_program_stage`), no self-approval (`decide_approval`), no self-verification of
  evidence, review/verification rights for submissions and results, server-side scoring.
* `audit_log` is written only by triggers, SECURITY DEFINER functions and Edge Functions; it cannot
  be written or deleted through the API.
* Privileged operations (user creation, organization creation, invitations, AI, imports, dispatch)
  run in Edge Functions that validate the JWT and re-check permissions with the database's own helpers.

## Changes from the previous package

The supplied `000_full_install.sql` could not be installed on a fresh project (migration 008
created policies on `organization_id` columns that the 002 tables did not have; 007 referenced
`sessions.organization_id` before it existed), beneficiaries/experts/vendors were readable and
writable by every authenticated user across tenants, storage allowed any authenticated user to
read every evidence file, entity codes were globally unique, and the first sign-up could claim
platform ownership. The canonical schema here replaces it; table names were kept where the
concept is unchanged (`programs`, `beneficiaries`, `experts`, `vendors`, `partners`, `sessions`,
`program_*`, `assessment_*`, `form_templates`, `form_submissions`, `maturity_*`, `impact_frameworks`,
`evidence`, `reports`, `notifications`, `roles`, `permissions`, `user_roles`, `user_invitations`…).
Demo mode was removed: the app never shows sample data as real data.

## Further documentation

* `docs/BACKEND_VERIFICATION.md` — step-by-step backend acceptance checklist (Definition of Done)
* `docs/DEPLOYMENT_HOSTINGER.md` — Hostinger deployment, backups, monitoring
* `docs/EDGE_FUNCTIONS.md` — function contracts
* `docs/DEVELOPMENT.md` — code conventions
