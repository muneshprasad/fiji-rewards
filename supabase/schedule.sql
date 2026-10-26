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
