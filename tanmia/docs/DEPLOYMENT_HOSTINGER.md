# Deploying TANMIA to Hostinger

The frontend is a static single-page application. Hostinger serves the files; Supabase
serves data, auth, storage and Edge Functions.

## Build

```bash
cp .env.example .env
#   VITE_SUPABASE_URL=https://<ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon / publishable key>      ← never the service-role key
#   VITE_PUBLIC_APP_URL=https://app.example.sa            ← optional
npm ci
npm run build
npm run verify:build
```

`dist/` contains `index.html`, hashed `assets/*`, `favicon.svg` and `.htaccess`.

## Upload

1. hPanel → Websites → your domain (or a sub-domain such as `app.example.sa`) → File Manager.
2. Open the document root (`public_html/` or the sub-domain folder) and remove old files.
3. Upload the **contents** of `dist/` — not the folder itself. Make sure the hidden `.htaccess`
   is uploaded (enable "show hidden files"). With FTP: `lftp -e "mirror -R dist/ public_html/; quit" -u USER ftp.example.sa`.
4. hPanel → Security → SSL: enable the free certificate; `.htaccess` then forces HTTPS.

The `.htaccess` rewrites every non-file URL to `index.html`, so deep links such as
`/app/programs/<id>/journey` or `/invite/<token>` work on refresh. It also sets
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
HSTS, long-term caching for hashed assets and no-cache for `index.html`.

If the app is served from a sub-folder (e.g. `example.sa/tanmia/`), build with
`npx vite build --base=/tanmia/` and change `RewriteBase /` and the final rule to
`RewriteBase /tanmia/` and `RewriteRule ^ /tanmia/index.html [L]`.

## Supabase settings that must match the domain

* Authentication → URL configuration: Site URL = `https://app.example.sa`; redirect URLs include
  `https://app.example.sa/reset-password` and `https://app.example.sa/invite/*`.
* Edge Function secret `APP_URL=https://app.example.sa`.

## Release procedure

1. `npm test && npm run test:db && npm run build && npm run verify:build`
2. `npx supabase db push` (new migrations), `npx supabase functions deploy`
3. Upload `dist/` contents; hard-refresh and check sign-in, `/platform` (owner) and `/app/dashboard`.

## Operations

* **Backups**: enable Supabase daily backups / PITR (Pro plan). Storage buckets `evidence`,
  `documents`, `imports` are included in Supabase storage backups; for an additional off-site copy
  run `supabase db dump --data-only` and an object sync on a schedule. Test a restore into a
  staging project quarterly; run `health_check.sql` after restore.
* **Monitoring**: Supabase → Reports (API, auth, database), Edge Function logs (`supabase functions logs <name>`),
  and Hostinger uptime monitoring on `/`. The UI error boundary logs unexpected errors to the
  browser console; forward them to your monitoring endpoint in `src/app/ErrorBoundary.tsx`.
* **Data residency (Saudi Arabia)**: choose the `me-central-1` region, or self-host Supabase in a
  KSA region; keep LLM features disabled (no `ANTHROPIC_API_KEY`) if data may not leave the
  jurisdiction — the rules engine continues to provide all analysis.
* **Timezone**: all dates are entered and displayed in Asia/Riyadh (UTC+3) and stored as UTC.
