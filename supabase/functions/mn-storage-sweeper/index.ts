// Removes files in the mn-resources bucket whose resource row no longer exists (ADR 0005).
// Deploy: `npx supabase functions deploy mn-storage-sweeper`; schedule daily with Supabase Cron.
// Only the service role may call it: the function rejects any other bearer token.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const BUCKET = 'mn-resources';
const MAX_ROUNDS = 20;

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return Response.json({ error: 'missing configuration' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${key}`) return Response.json({ error: 'forbidden' }, { status: 403 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await admin.rpc('mn_orphan_objects', { p_limit: 1000 });
    if (error) return Response.json({ error: error.message, removed }, { status: 500 });
    const names = (data as { name: string }[]).map((r) => r.name);
    if (names.length === 0) break;
    for (let i = 0; i < names.length; i += 100) {
      const { error: rmError } = await admin.storage.from(BUCKET).remove(names.slice(i, i + 100));
      if (rmError) return Response.json({ error: rmError.message, removed }, { status: 500 });
      removed += Math.min(100, names.length - i);
    }
  }
  return Response.json({ removed });
});
