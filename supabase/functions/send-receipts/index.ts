// Supabase Edge Function (Deno). Called every minute by pg_cron (see supabase/schedule.sql).
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { processBatch, twilioSender } from './core.ts';

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const send = twilioSender(
    {
      accountSid: Deno.env.get('TWILIO_ACCOUNT_SID')!,
      authToken: Deno.env.get('TWILIO_AUTH_TOKEN')!,
      messagingServiceSid: Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')!,
    },
    fetch as never,
  );
  const summary = await processBatch({
    claim: async (n) => {
      const { data, error } = await db.rpc('claim_sms_batch', { p_limit: n });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    mark: async (id, ok, err) => {
      const { error } = await db.rpc('mark_sms', { p_id: id, p_ok: ok, p_error: err ?? null });
      if (error) throw new Error(error.message);
    },
    send,
  });
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
