# Backend verification checklist (Definition of Done)

Two layers of verification:

* **Automated (local)** — `npm run test:db` applies all migrations to a throwaway PostgreSQL 16 with
  emulated Supabase `auth`/`storage` schemas and runs `supabase/tests/*.sql`; `npm test` runs the engine
  and routing unit tests. These prove the schema, RLS, triggers, RPCs and scoring logic.
* **On the real Supabase project** — the manual checks below prove Auth, Storage, Edge Functions and
  the deployed frontend together. Record date / tester / result for each line before go-live.

| # | Requirement | Automated evidence | Manual check on the Supabase project |
|---|---|---|---|
| 1 | Schema installed | `test:db` applies every migration; `health_check.sql` → all PASS | Run `supabase/health_check.sql` in the SQL editor: all rows PASS |
| 2 | Auth tested | — | Sign in / wrong password / sign out / reload keeps session / forgot-password email → `/reset-password` sets a new password |
| 3 | Platform Super Admin | `10_setup.sql`: owner has no membership, `my_access` reports super admin; `routing.test.ts` | `promote_platform_super_admin(email)`; sign in → lands on `/platform`, never asked for an invitation or organization |
| 4 | Organization creation | `10_setup.sql`: owner creates two orgs via RLS; 10 roles + 14 modules seeded; non-owner rejected (`20_tenancy_rls.sql`) | Platform → Organizations → Create (with initial admin email) → organization listed; admin receives invitation link |
| 5 | Membership & RBAC | `20_tenancy_rls.sql`: aggregated permissions, viewer read-only, coordinator cannot delete or self-escalate, module deactivation hides data | Invite a user with two roles, accept at `/invite/<token>`, verify menu matches permissions and that a viewer cannot create |
| 6 | RLS isolation (2 orgs) | `20_tenancy_rls.sql`: admin B cannot read/update/insert org A data, cross-org references rejected, org_id immutable, audit/profile isolation | With two org admins in two browsers, open the other org's program URL → "not found"; REST call with admin B token to `/rest/v1/programs?id=eq.<A>` returns `[]` |
| 7 | Storage | `30_workflows.sql`: upload in own org path only, cross-org read/delete denied, viewer read-only, delete with permission | Upload evidence in a program, open via signed URL, delete; try the same path from the other org → denied |
| 8 | Edge Functions deployed | `deno check` of all 16 functions | `supabase functions list`; call `ai-program-analysis {mode:'status'}` and `dispatch-notification {action:'status'}` from Platform → Integrations |
| 9 | Program creation & workspace | `20_tenancy_rls.sql` codes + stages; `30_workflows.sql` six journeys (9/9/21/12/13/9 stages) | Create one program per track; open every workspace tab; health insights appear with rationale |
| 10 | Journey gates | `30_workflows.sql`: dependency block, evidence block, approval request, no self-approval, override needs approve permission | Complete a stage requiring evidence/approval from the Journey tab |
| 11 | Scheduling | `30_workflows.sql` conflict RPC; `engine.test.ts` scheduling | Schedule two overlapping sessions for one expert → warning shown before saving; bulk-schedule 8 sessions |
| 12 | Assessment submission & scoring | `30_workflows.sql` SQL scoring equals `fixtures/scoring.json`; `engine.test.ts` identical results in TS | Record a result in Assessments; live preview equals stored score; verify it as quality officer |
| 13 | Maturity T0/T1 | `30_workflows.sql` weighted overall, scale/dimension validation, one per point; `engine.test.ts` comparison | Record T0 and T1 for ≥2 beneficiaries; program Assessments tab shows before/after/change with "observed change" note |
| 14 | Impact indicator measurement | `30_workflows.sql` measurement inherits program/org; `engine.test.ts` claim levels | Add indicator + T0/T1 measurements; Impact tab shows claim level and allowed statement |
| 15 | Evidence linkage & verification | `30_workflows.sql`: verifier recorded, no self-verify, non-verifier forced to pending | Link evidence to stage/indicator/session; verify from the queue |
| 16 | Report generation | `engine.test.ts` buildReport (18 sections) | Reports → create Final Comprehensive → Generate (Edge Function) → version 1 saved → submit for approval → approve in Governance |
| 17 | Notifications | `30_workflows.sql`: users see only their own, mark read | Add a notification rule (session_reminder, −60 min), schedule a session, run `dispatch-notification`; bell shows the reminder; email/SMS show `sent` or `skipped: not_configured` |
| 18 | Audit trail | `20_tenancy_rls.sql`: inserts audited, audit not writable/deletable via API | Governance → Audit shows program/stage/approval changes with old/new values |
| 19 | No service-role exposure | `npm run verify:build` scans `dist/` | Inspect the deployed JS bundle: only the anon key is present |
| 20 | Arabic RTL / English LTR | — | Toggle language: layout mirrors, navigation stays on the reading-start side, dates in Asia/Riyadh |

Additional go-live checks: SMTP configured; `APP_URL` matches the Hostinger domain; cron jobs
scheduled; backups enabled; at least two platform owners; public sign-up policy decided.
