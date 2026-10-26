-- Scheduled jobs. Run this once in the Supabase SQL editor after enabling the pg_cron extension
-- (Dashboard > Database > Extensions). Times are UTC; Fiji is UTC+12, so 12:05 UTC is 00:05 the next day in Fiji.
--
-- Expire points older than 12 months, once a day:
select cron.schedule('expire-points', '5 12 * * *', $$select expire_points()$$);
--
-- Look for unusual patterns and raise alerts, every 15 minutes (safe to repeat; each pattern is only recorded once per day):
select cron.schedule('detect-fraud', '*/15 * * * *', $$select detect_fraud()$$);
--
-- Make someone a network admin (so they see the Alerts tab and can suspend customers and shops):
--   insert into network_admins (user_id) select id from auth.users where phone = '679XXXXXXX';

-- Send SMS receipts every minute. Needs the pg_net extension and the send-receipts Edge Function deployed.
-- Store the service role key in Vault once (never paste it into the cron command itself):
--   select vault.create_secret('<your service role key>', 'service_role_key');
-- Then replace YOUR-PROJECT-REF with your project's reference id:
select cron.schedule('send-receipts', '* * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-receipts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb
  )
$$);
