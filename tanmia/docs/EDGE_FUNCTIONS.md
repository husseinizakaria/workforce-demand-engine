# TANMIA Edge Functions — contract

All functions live in `supabase/functions/<name>/index.ts` (Deno), share code from
`supabase/functions/_shared/`, and are called from React with
`callFunction(name, body)` (`src/services/functions.ts`), which attaches the user's JWT.

## Common rules (every function)

1. `OPTIONS` → CORS preflight. Only `POST` (plus `GET` for the public ICS feed).
2. Validate the JWT: `Authorization: Bearer <jwt>` → `auth.getUser(jwt)` with an anon client. Missing/invalid → 401.
3. Determine the caller (`user.id`), and authorize with the **database's own** helpers called as the user
   (user-scoped client → `rpc('is_platform_super_admin')`, `rpc('has_permission', {org, permission_code})`,
   `rpc('module_enabled', ...)`). Never trust a browser-supplied `organization_id` without this check, and
   always verify referenced records (program, tool, report, evidence…) belong to that organization.
4. Validate input (`_shared/validate.ts`). Bad input → 400 `{code:'invalid_input', field}`.
5. The service-role client (`SUPABASE_SERVICE_ROLE_KEY`) is used **only** after authorization, for privileged writes.
6. Response JSON: success `{ ok: true, data }`; failure `{ ok: false, error: { code, message_ar, message_en, detail? } }` with HTTP 400/401/403/404/409/412/500.
7. Privileged changes are written to `audit_log` with `source='edge_function'`.
8. Cron-style calls (dispatch, health check) authenticate with header `x-cron-secret: $CRON_SECRET` instead of a JWT.

Secrets (Edge Function environment only — never in the frontend):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase),
`APP_URL`, `CRON_SECRET`, optional `ANTHROPIC_API_KEY` + `AI_MODEL` (default `claude-opus-5-5`),
optional `RESEND_API_KEY` + `EMAIL_FROM`, optional `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_SMS_FROM` + `TWILIO_WHATSAPP_FROM`.

When an optional provider is not configured the function says so explicitly
(`email_status: 'not_configured'`, `generated_by: 'rules'`, delivery `skipped` with reason) — nothing is faked.

## Functions

| Function | Who | Body → data |
|---|---|---|
| `admin-create-user` | super admin, or `users.create` on `organization_id` | `{email, full_name, job_title?, password?, organization_id?, role_ids?[], is_platform_super_admin? (super admin only)}` → `{user_id, created: boolean, setup_link: string\|null, email_status}`. Existing auth user with same email is reused (membership added). Without password a recovery/invite link is generated and emailed if email is configured, else returned once as `setup_link`. |
| `admin-update-user` | `action:'list'` / `'get'` super admin; `'update'` super admin or `users.edit` on org | `list: {page?, per_page?, search?}` → `{users:[{id,email,full_name,last_sign_in_at,created_at,banned,is_platform_super_admin,memberships:[{organization_id,organization_name,active,roles:[code]}]}], total}`. `update: {user_id, organization_id?, full_name?, job_title?, phone?, member_active?, role_ids?[] (needs users.assign), banned? (super admin), is_platform_super_admin? (super admin; cannot demote self), send_password_reset?}` → `{user_id, updated:[...]}` |
| `admin-create-organization` | super admin | `{name, name_en?, org_type?, sector?, city?, contact_email?, default_locale?, modules?: {key:boolean}, admin?: {email, full_name}}` → `{organization, admin: {user_id\|null, invitation_link\|null, email_status}\|null}` (admin gets the `org_admin` role; existing user → direct membership, otherwise invitation). |
| `send-invitation` | `users.create` on org | `{action?: 'create'\|'revoke'\|'resend', organization_id, email, full_name?, job_title?, role_ids[], link_beneficiary_id?, link_expert_id?, expires_in_days? (1-30)}` / `{action:'revoke', invitation_id}` → `{invitation_id, link, expires_at, email_status}`. Raw token returned once; only `sha256(token)` stored. |
| `accept-invitation` | `preview`: anyone with token; `accept`: signed-in user whose email matches | `{action:'preview', token}` → `{organization:{name,name_en,code}, email_masked, full_name, roles:[{name_ar,name_en}], expires_at, status}`; `{action:'accept', token}` → `{organization_id}` (membership, roles, beneficiary/expert link, audit). |
| `schedule-notification` | `notifications.create` or `operations.edit` on org | `{organization_id, event_type, entity_type, entity_id, payload?}` → `{created, skipped}`. Applies active `notification_rules` (audience, channels, offset). Session events resolve participants (linked users), expert, program manager. |
| `dispatch-notification` | cron secret (all orgs) or `notifications.configure` (one org) | `{organization_id?, limit?}` → `{processed, sent, failed, skipped}`; `{action:'status'}` → `{email, sms, whatsapp}` booleans. In-app → `sent`; email via Resend; SMS/WhatsApp via Twilio; unconfigured → `skipped` with reason. |
| `generate-report` | `reports.create` on the report's org | `{report_id, use_llm?: boolean, manual_text?: {section:{ar,en}}}` → `{version, content, narrative, generator}`; writes `report_versions`, bumps `reports.current_version`, status `generated`. |
| `ai-program-analysis` | `programs.view` | `{mode:'analyze', organization_id, program_id, persist?, locale?}` → `{health, narrative, generated_by, model, persisted}`; `{mode:'ask', organization_id, program_id?, question, locale?}` → `{answer:{intent,answer,sources}, narrative, generated_by, model}`; `{mode:'status'}` → `{llm: boolean, model}`. |
| `ai-assessment-interpretation` | `assessments.view` (`translate_questions` needs `assessments.edit`) | `{mode:'result', organization_id, result_id}` → `{result, strengths, development_areas, recommendations, narrative, generated_by}`; `{mode:'cohort', organization_id, tool_id, program_id?, measurement_point?}` → `{n, mean, distribution, dimensions, narrative, generated_by}`; `{mode:'translate_questions', organization_id, tool_id, target:'ar'\|'en'}` → `{updated}` (requires LLM → else 412 `llm_not_configured`). |
| `ai-impact-analysis` | `impact.view` | `{organization_id, program_id, compare_from?, compare_to?}` → `{chain, indicators:[{indicator, performance, claim}], maturity, evidence, narrative, generated_by}` |
| `expert-matching` | `experts.view` | `{organization_id, program_id?, requirements: MatchRequirements, limit?}` → `{results: MatchResult[]}` (sponsor name added to conflict terms automatically). |
| `import-external-assessment` | `assessments.create` | `{organization_id, tool_id, program_id?, measurement_point, provider?, file_path? (imports bucket, org-scoped) \| csv_text?, mapping: {identifier:'code'\|'email'\|'national_id', identifier_column, dimensions:{dimension_id: column}}, source_scale?: {min,max}, dry_run?}` → `{import_id\|null, rows, matched, imported, unmatched:[{row, identifier}], preview:[{identifier, beneficiary_id, dimension_scores}]}` (scores rescaled to tool scale; DB trigger computes totals). |
| `evidence-verification` | `evidence.verify` (`gaps`: `evidence.view`) | `{action:'verify'\|'reject'\|'needs_info', organization_id, evidence_id, notes?}` → `{evidence}` (uploader may not self-verify; uploader notified on reject/needs_info); `{action:'gaps', organization_id, program_id}` → `EvidenceCompleteness`. |
| `calendar-sync` | member of org | `{action:'ics', organization_id, scope:'session'\|'program'\|'expert'\|'me', id?}` → `{filename, ics}`; `{action:'create_feed', organization_id, scope, scope_id?}` → `{feed_url}` (token hashed); `GET ?feed=<token>` → `text/calendar`. |
| `program-health-check` | `programs.view` on org, or cron secret | `{organization_id, program_id?}` → `{programs:[{program_id, score, grade, insights_open, created, resolved}]}`. Persists `ai_insights` (dedupe by fingerprint, resolves insights no longer detected), notifies admins of new critical/high insights. |
