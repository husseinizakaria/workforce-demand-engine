#!/usr/bin/env node
// Production build verification for Hostinger deployment.
// Run after `npm run build`. Fails (exit 1) on any problem.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const problems = [];
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { problems.push(m); console.log(`  ✘ ${m}`); };

console.log('TANMIA production build verification');
if (!existsSync(dist)) { console.error('dist/ not found — run npm run build first'); process.exit(1); }

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(dist);

existsSync(join(dist, 'index.html')) ? ok('index.html present') : bad('index.html missing');
const htaccess = join(dist, '.htaccess');
if (existsSync(htaccess) && /RewriteRule \^ index\.html/.test(readFileSync(htaccess, 'utf8'))) ok('.htaccess SPA rewrite present');
else bad('.htaccess with SPA rewrite missing from dist/');

const js = files.filter((f) => f.endsWith('.js'));
js.length ? ok(`${js.length} JavaScript chunks`) : bad('no JavaScript output');

const text = files.filter((f) => /\.(js|html|css|json|txt|map)$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')]);
const SECRET_PATTERNS = [
  [/service_role/i, 'the string "service_role"'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'a Supabase secret key (sb_secret_)'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'an Anthropic API key'],
  [/re_[A-Za-z0-9]{20,}/, 'a Resend API key'],
  [/SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|TWILIO_AUTH_TOKEN|RESEND_API_KEY|CRON_SECRET/, 'a server secret variable name'],
];
let leaks = 0;
for (const [f, c] of text) for (const [re, label] of SECRET_PATTERNS) {
  // The client deliberately contains the literal 'service_role' only inside the guard that refuses such keys.
  if (label.startsWith('the string') && /jwtRole\(|isServiceKeyMisconfigured/.test(c)) {
    const stripped = c.replace(/["']service_role["']/g, '');
    if (!re.test(stripped)) continue;
  }
  if (re.test(c)) { leaks++; bad(`${f.replace(dist, 'dist/')} contains ${label}`); }
}
if (!leaks) ok('no server secrets in the bundle');

// JWT-shaped strings: anon keys are allowed, service-role JWTs are not.
for (const [f, c] of text) for (const jwt of c.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.role && payload.role !== 'anon') bad(`${f.replace(dist, 'dist/')} embeds a JWT with role "${payload.role}"`);
    else ok('embedded Supabase key is an anon key');
  } catch { /* not a JWT */ }
}

const allJs = js.map((f) => readFileSync(f, 'utf8')).join('\n');
if (/https:\/\/[a-z0-9-]+\.supabase\.(co|in)|https?:\/\/[^"'\s]+\/auth\/v1/.test(allJs) || /VITE_SUPABASE_URL/.test(allJs) === false) ok('Supabase URL compiled into the bundle (or custom domain)');
if (!process.env.VITE_SUPABASE_URL && !existsSync(new URL('../.env', import.meta.url))) console.log('  ! no .env found — the build will show the "Platform not configured" screen until rebuilt with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

const size = files.reduce((a, f) => a + statSync(f).size, 0);
ok(`total size ${(size / 1024).toFixed(0)} KB`);

if (problems.length) { console.error(`\n${problems.length} problem(s) found.`); process.exit(1); }
console.log('\nBuild verified: upload the CONTENTS of dist/ (including .htaccess) to public_html on Hostinger.');
