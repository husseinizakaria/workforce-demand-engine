// Supabase-shaped gateway for the local E2E stack:
//   /auth/v1/*      → GoTrue      /rest/v1/* → PostgREST      /functions/v1/<name> → Deno process
import http from 'node:http';
const AUTH = Number(process.env.AUTH_PORT), REST = Number(process.env.REST_PORT);
const FN = JSON.parse(process.env.FUNCTION_PORTS ?? '{}');
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-cron-secret',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, content-profile, x-total-count',
};
http.createServer((req, res) => {
  const url = req.url ?? '/';
  let port, path;
  if (url.startsWith('/auth/v1')) { port = AUTH; path = url.slice(8) || '/'; }
  else if (url.startsWith('/rest/v1')) { port = REST; path = url.slice(8) || '/'; }
  else if (url.startsWith('/functions/v1/')) {
    const name = url.slice(14).split(/[/?]/)[0]; port = FN[name]; path = url.slice(14 + name.length) || '/';
    if (!port) { res.writeHead(404, cors).end(JSON.stringify({ message: 'function not found' })); return; }
  } else { res.writeHead(404, cors).end('not found'); return; }
  if (req.method === 'OPTIONS' && !url.startsWith('/functions/')) { res.writeHead(204, cors).end(); return; }
  const up = http.request({ host: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    const headers = { ...r.headers };
    if (!url.startsWith('/functions/')) Object.assign(headers, cors);
    res.writeHead(r.statusCode ?? 502, headers); r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors).end(JSON.stringify({ message: String(e) })); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => console.log(`gateway on http://127.0.0.1:${PORT}`));
