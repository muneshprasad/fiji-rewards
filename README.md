# Fiji Rewards

A shared loyalty wallet for Fiji. Earn points at any participating shop with one QR code, redeem at any member shop. See `CLAUDE.md` for the full brief and scope.

## Status
Steps 1-8 done: schema and RLS, phone OTP login, the transactions engine, the merchant till app, the customer app, and the offline queue at the till (earn sales saved on the phone and sent when the signal returns; redemptions need a connection). Staff accounts open the till; everyone else sees the customer app. Managers also get a Today screen and rewards and points-rate setup. Fraud controls: signed QR codes that renew every 20 seconds and work once, extra daily and hourly limits, alerts for odd patterns, and admin actions to suspend a customer or shop. Scheduled jobs are in `supabase/schedule.sql`.

## Layout
- `app/` Expo (React Native) app: phone + OTP login, profile with points balance. `cd app && npm install && npm test && npm run typecheck`
- `brand/` logo source SVGs and PNGs (mark, adaptive-icon foreground, horizontal lockup)
- `supabase/migrations/` schema, RLS, audit log
- `supabase/seed.sql` 6 sample Nadi merchants with rewards
- `supabase/tests/schema_test.sql` checks for balance, append-only transactions, idempotency, redemption codes, RLS

## Design notes
- Balance is derived (`customer_balances` view); `transactions` is append-only (update, delete, truncate are blocked by triggers).
- Clients get no direct write on `transactions` or `redemption_codes`; step 3 adds security-definer functions for earn, redeem and expire.
- Rule values (earn rate bounds, max sale, scan limit, expiry, code lifetime) live in `network_settings`.
- `transactions.client_txn_id` is the idempotency key for the offline queue.

## Running the schema tests
On any Postgres 15+, run `supabase/tests/stub_supabase.sql` first (stand-ins for `auth.users`, `auth.uid()` and the `authenticated` role), then the migrations in order, `seed.sql`, `schema_test.sql` and `auth_test.sql`, each with `psql -v ON_ERROR_STOP=1`.
