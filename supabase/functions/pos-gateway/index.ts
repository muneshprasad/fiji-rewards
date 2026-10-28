// Supabase Edge Function (Deno). Deploy with:  supabase functions deploy pos-gateway --no-verify-jwt
// (POS systems authenticate with the shop's own API key, not a Supabase login.)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (request) => {
  let body: unknown = undefined;
  try { body = request.method === 'POST' ? await request.json() : undefined; } catch { body = null; }
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const res = await handle(
    { method: request.method, path: new URL(request.url).pathname, headers, body },
    async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };   // the API key is never logged
    },
  );
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
});
