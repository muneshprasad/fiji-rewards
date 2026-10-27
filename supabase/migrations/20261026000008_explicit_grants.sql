-- Newer Supabase projects do not give signed-in users access to new tables automatically.
-- This grants exactly what the app needs. Row-level security (the policies in earlier migrations)
-- still decides WHICH rows each person can see or change; these grants only open the door to the table.
-- Nothing is granted to the anonymous role: everything in the app requires sign-in.

grant usage on schema public to authenticated;

-- read-only for signed-in users (RLS filters the rows)
grant select on
  customers, customer_balances, customer_secrets, merchants, staff, rewards,
  transactions, redemption_codes, network_settings, alerts
to authenticated;

-- owners (managers) add and edit rewards; RLS limits this to their own shop's managers
grant insert, update on rewards to authenticated;

-- column-limited edits made earlier in the schema, repeated here so the grants are in one place
grant update (name, language, sms_receipts) on customers to authenticated;
grant update (business_name, category, address, points_per_fjd) on merchants to authenticated;

-- Everything else (transactions, redemption codes, the audit log, the SMS outbox, network admins)
-- is written only through the database functions, which run with their own permissions.
