-- Fiji Rewards: initial schema (build step 1)
-- Rule: balance = sum of a customer's transactions. Transactions are append-only.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type customer_status as enum ('active', 'suspended');
create type merchant_status as enum ('pending', 'active', 'suspended');
create type staff_role as enum ('cashier', 'manager');
create type txn_type as enum ('earn', 'redeem', 'expire', 'adjust');
create type sync_status as enum ('pending', 'synced');

-- ---------------------------------------------------------------- network settings
-- Starting values from the brief, all configurable.
create table network_settings (
  key text primary key,
  value numeric not null,
  description text
);
insert into network_settings (key, value, description) values
  ('default_points_per_fjd',  1,   'Default earn rate: points per FJD 1'),
  ('min_points_per_fjd',      0.5, 'Lowest rate a merchant may set'),
  ('max_points_per_fjd',      5,   'Highest rate a merchant may set'),
  ('welcome_bonus_points',    20,  'Points granted on first sign-in'),
  ('referral_bonus_points',   50,  'Referral bonus (V2, unused in V1)'),
  ('points_expiry_months',    12,  'Points expire this many months after earning'),
  ('max_sale_fjd',            500, 'Maximum sale amount per scan'),
  ('max_scans_per_hour',      3,   'Max earn scans per customer per merchant per hour'),
  ('redeem_code_minutes',     10,  'Redemption code lifetime');

-- ---------------------------------------------------------------- core tables
create table customers (
  id uuid primary key references auth.users (id) on delete restrict,
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name text,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  referral_code text not null unique default upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8)),
  status customer_status not null default 'active'
);

create table merchants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  category text not null,
  town text not null,
  address text,
  lat double precision,
  lng double precision,
  owner_phone text not null check (owner_phone ~ '^\+[1-9][0-9]{7,14}$'),
  points_per_fjd numeric(6,2) not null default 1 check (points_per_fjd > 0),
  status merchant_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index merchants_town_category_idx on merchants (town, category) where status = 'active';

create table staff (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants (id) on delete restrict,
  user_id uuid unique references auth.users (id) on delete restrict,
  name text not null,
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role staff_role not null default 'cashier',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_merchant_idx on staff (merchant_id);

create table rewards (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants (id) on delete cascade,
  title text not null,
  points_cost integer not null check (points_cost > 0),
  value_fjd numeric(10,2) not null check (value_fjd >= 0),
  active_from timestamptz not null default now(),
  active_to timestamptz,
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  check (active_to is null or active_to > active_from)
);
create index rewards_merchant_idx on rewards (merchant_id);

-- ---------------------------------------------------------------- transactions (append-only)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete restrict,
  merchant_id uuid references merchants (id) on delete restrict,  -- null for expire / network adjust
  staff_id uuid references staff (id) on delete restrict,
  type txn_type not null,
  amount_fjd numeric(10,2) not null default 0 check (amount_fjd >= 0),
  points_change integer not null,
  expires_at timestamptz,                  -- set on earn rows: created + 12 months
  note text,
  created_at timestamptz not null default now(),   -- the "timestamp" field
  device_id text,
  client_txn_id uuid unique,               -- idempotency key from the offline queue
  sync_status sync_status not null default 'synced',
  check (
    (type = 'earn'   and points_change > 0) or
    (type = 'redeem' and points_change < 0) or
    (type = 'expire' and points_change < 0) or
    (type = 'adjust' and points_change <> 0)
  ),
  check (type in ('expire', 'adjust') or merchant_id is not null)
);
create index transactions_customer_idx on transactions (customer_id, created_at desc);
create index transactions_merchant_idx on transactions (merchant_id, created_at desc);

create function forbid_txn_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'transactions are append-only (% blocked)', tg_op;
end $$;

create trigger transactions_no_update before update on transactions
  for each row execute function forbid_txn_mutation();
create trigger transactions_no_delete before delete on transactions
  for each row execute function forbid_txn_mutation();
create trigger transactions_no_truncate before truncate on transactions
  for each statement execute function forbid_txn_mutation();

-- Balance is always derived, never stored or edited.
create view customer_balances with (security_invoker = true) as
  select customer_id, coalesce(sum(points_change), 0)::integer as balance
  from transactions
  group by customer_id;

-- ---------------------------------------------------------------- redemption codes
create table redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code char(6) not null check (code ~ '^[0-9]{6}$'),
  customer_id uuid not null references customers (id) on delete restrict,
  merchant_id uuid not null references merchants (id) on delete restrict,
  reward_id uuid not null references rewards (id) on delete restrict,
  points_cost integer not null check (points_cost > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  transaction_id uuid references transactions (id),
  check (expires_at > created_at)
);
-- A 6-digit code is unique among codes that can still be used.
create unique index redemption_codes_open_idx on redemption_codes (merchant_id, code)
  where used_at is null;

-- ---------------------------------------------------------------- audit log
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                 -- auth.uid() when available
  action text not null,
  table_name text not null,
  row_id text,
  details jsonb
);
create index audit_log_table_idx on audit_log (table_name, at desc);

create function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (actor, action, table_name, row_id, details)
  values (auth.uid(), tg_op, tg_table_name, rec ->> 'id',
          case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
               else rec end);
  return coalesce(new, old);
end $$;

create trigger audit_transactions after insert on transactions
  for each row execute function audit_row_change();
create trigger audit_merchants after insert or update or delete on merchants
  for each row execute function audit_row_change();
create trigger audit_staff after insert or update or delete on staff
  for each row execute function audit_row_change();
create trigger audit_rewards after insert or update or delete on rewards
  for each row execute function audit_row_change();
create trigger audit_customers after update or delete on customers
  for each row execute function audit_row_change();
create trigger audit_redemption_codes after insert or update on redemption_codes
  for each row execute function audit_row_change();
create trigger audit_settings after insert or update or delete on network_settings
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------- row-level security
-- Writes to transactions and redemption_codes go through security-definer
-- functions added in step 3; clients get no direct insert/update/delete.

create function current_staff_merchant() returns uuid
language sql stable security definer set search_path = public as $$
  select merchant_id from staff where user_id = auth.uid() and active
$$;

create function current_staff_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from staff where user_id = auth.uid() and active), false)
$$;

alter table network_settings  enable row level security;
alter table customers         enable row level security;
alter table merchants         enable row level security;
alter table staff             enable row level security;
alter table rewards           enable row level security;
alter table transactions      enable row level security;
alter table redemption_codes  enable row level security;
alter table audit_log         enable row level security;  -- no policies: service role only

create policy settings_read on network_settings for select to authenticated using (true);

create policy customers_self_read on customers for select to authenticated
  using (id = auth.uid());
create policy customers_self_update on customers for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Staff may look up a customer (by phone/QR) only through a function in step 3.

create policy merchants_public_read on merchants for select to authenticated
  using (status = 'active' or id = current_staff_merchant());
create policy merchants_manager_update on merchants for update to authenticated
  using (id = current_staff_merchant() and current_staff_is_manager())
  with check (id = current_staff_merchant() and current_staff_is_manager());

create policy staff_same_merchant_read on staff for select to authenticated
  using (user_id = auth.uid() or merchant_id = current_staff_merchant());

create policy rewards_public_read on rewards for select to authenticated
  using (exists (select 1 from merchants m where m.id = merchant_id and m.status = 'active')
         or merchant_id = current_staff_merchant());
create policy rewards_manager_write on rewards for all to authenticated
  using (merchant_id = current_staff_merchant() and current_staff_is_manager())
  with check (merchant_id = current_staff_merchant() and current_staff_is_manager());

create policy transactions_customer_read on transactions for select to authenticated
  using (customer_id = auth.uid());
create policy transactions_merchant_read on transactions for select to authenticated
  using (merchant_id = current_staff_merchant());

create policy codes_customer_read on redemption_codes for select to authenticated
  using (customer_id = auth.uid());
create policy codes_merchant_read on redemption_codes for select to authenticated
  using (merchant_id = current_staff_merchant());

-- Column-level guard: owners may change the rate, not the status.
revoke update on merchants from authenticated;
grant update (business_name, category, address, points_per_fjd) on merchants to authenticated;
revoke update on customers from authenticated;
grant update (name, language) on customers to authenticated;
