# Fiji Rewards

A shared loyalty wallet for Fiji. Earn points at any participating shop with one QR code, redeem at any member shop. See `CLAUDE.md` for the full brief and scope.

## Status
Build step 1 done: database schema, row-level security, seed data.

## Layout
- `supabase/migrations/` schema, RLS, audit log
- `supabase/seed.sql` 6 sample Nadi merchants with rewards
- `supabase/tests/schema_test.sql` checks for balance, append-only transactions, idempotency, redemption codes, RLS

## Design notes
- Balance is derived (`customer_balances` view); `transactions` is append-only (update, delete, truncate are blocked by triggers).
- Clients get no direct write on `transactions` or `redemption_codes`; step 3 adds security-definer functions for earn, redeem and expire.
- Rule values (earn rate bounds, max sale, scan limit, expiry, code lifetime) live in `network_settings`.
- `transactions.client_txn_id` is the idempotency key for the offline queue.

## Running the schema tests
On any Postgres 15+, stub Supabase's `auth.users` table, `auth.uid()` function and `authenticated` role, then run the migration, `seed.sql`, and `schema_test.sql` with `psql -v ON_ERROR_STOP=1`.
