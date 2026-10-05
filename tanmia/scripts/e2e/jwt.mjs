// Signs HS256 JWTs for the local stack (anon / service_role keys).
import { createHmac } from 'node:crypto';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sign(payload, secret) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
if (process.argv[2]) {
  const secret = process.argv[3];
  console.log(sign({ role: process.argv[2], iss: 'supabase-local', iat: 1700000000, exp: 2000000000 }, secret));
}
