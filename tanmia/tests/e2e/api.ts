// Direct API helpers for E2E setup (same gateway the browser uses).
const G = process.env.E2E_GATEWAY ?? 'http://127.0.0.1:54321';
const ANON = process.env.E2E_ANON ?? '';
const SERVICE = process.env.E2E_SERVICE ?? '';

async function j(res: Response) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
export async function createUser(email: string, password: string, full_name: string): Promise<string> {
  const r = await j(await fetch(`${G}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }) }));
  return r.id;
}
export async function token(email: string, password: string): Promise<string> {
  const r = await j(await fetch(`${G}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }));
  return r.access_token;
}
export async function rest(tok: string, path: string, init: { method?: string; body?: unknown } = {}) {
  return j(await fetch(`${G}/rest/v1/${path}`, { method: init.method ?? 'GET', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
}
export async function fn(tok: string, name: string, body: unknown) {
  return j(await fetch(`${G}/functions/v1/${name}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}
