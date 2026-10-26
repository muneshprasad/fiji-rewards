-- Build step 8: fraud limits and alerts.
--  * Customer QR codes are signed and short-lived. The phone signs "customer id : time" with a secret
--    only the customer and the server know, so a screenshot stops working within minutes and each
--    code can be used once. The server checks the signature against the time of the SALE, so sales
--    saved offline at the till still verify when they are sent later.
--  * More limits: points per customer per day, sales per till per hour, redemptions per customer per day.
--  * Alerts for odd patterns, and actions for a network admin (dismiss, suspend a customer or shop).

-- pgcrypto lives in the "extensions" schema on Supabase; functions that use it need it on their search path.
alter function new_redemption_code(uuid) set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into network_settings (key, value, description) values
  ('max_daily_points_per_customer',        1000, 'Most points one customer can earn in a Fiji day'),
  ('max_sales_per_till_per_hour',          40,   'Most earn sales one cashier login can record per hour'),
  ('max_redemptions_per_customer_per_day', 3,    'Most rewards one customer can redeem per Fiji day'),
  ('qr_past_seconds',                      300,  'A customer QR is accepted up to this long after it was made'),
  ('qr_future_seconds',                    120,  'Allowed clock difference for a QR made "in the future"');

create function fiji_day_start(p_ts timestamptz) returns timestamptz
language sql immutable as $$ select date_trunc('day', p_ts at time zone 'Pacific/Fiji') at time zone 'Pacific/Fiji' $$;

-- ---------------------------------------------------------------- columns
-- The QR signing secret lives in its own table so that only the customer can ever read it
-- (admins and staff can see customer rows, but never secrets).
create table customer_secrets (
  customer_id uuid primary key references customers (id) on delete cascade,
  qr_secret text not null default encode(gen_random_bytes(32), 'hex')
);
alter table customer_secrets enable row level security;
create policy secrets_self_read on customer_secrets for select to authenticated using (customer_id = auth.uid());

create function create_customer_secret() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into customer_secrets (customer_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger customers_secret after insert on customers for each row execute function create_customer_secret();
insert into customer_secrets (customer_id) select id from customers on conflict do nothing;

alter table transactions
  add column entry_method text not null default 'manual' check (entry_method in ('qr', 'manual')),
  add column qr_nonce text unique;     -- "customer:timestamp" of the QR used; a code works once

-- ---------------------------------------------------------------- QR signing
create function qr_signature(p_customer uuid, p_ts bigint) returns text
language sql stable security definer set search_path = public, extensions as $$
  select left(encode(hmac(convert_to(p_customer::text || ':' || p_ts::text, 'UTF8'), decode(c.qr_secret, 'hex'), 'sha256'), 'hex'), 20)
  from customer_secrets c where c.customer_id = p_customer
$$;

create function verify_qr(p_customer uuid, p_ts bigint, p_sig text, p_at timestamptz) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  expected text;
  age numeric;
begin
  if p_ts is null or p_sig is null then raise exception 'qr_required'; end if;
  expected := qr_signature(p_customer, p_ts);
  if expected is null or lower(p_sig) <> expected then raise exception 'qr_invalid'; end if;
  age := extract(epoch from p_at) - p_ts;
  if age > setting_num('qr_past_seconds') or -age > setting_num('qr_future_seconds') then raise exception 'qr_expired'; end if;
end $$;

-- Lets phones correct their clock to the server's, in milliseconds.
create function server_time() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- ---------------------------------------------------------------- lookup (till)
drop function lookup_customer(uuid, text);
create function lookup_customer(
  p_customer_id uuid default null, p_phone text default null, p_qr_ts bigint default null, p_qr_sig text default null
) returns table (customer_id uuid, name text, phone text, balance integer)
language plpgsql stable security definer set search_path = public as $$
declare
  st staff := current_staff();
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if p_customer_id is null and p_phone is null then raise exception 'lookup_needs_id_or_phone'; end if;
  if p_customer_id is not null then
    perform verify_qr(p_customer_id, p_qr_ts, p_qr_sig, now());   -- a bare customer id is not enough
  end if;
  return query
    select c.id, c.name, c.phone, balance_of(c.id)
    from customers c
    where c.status = 'active' and (c.id = p_customer_id or c.phone = p_phone);
  if not found then raise exception 'customer_not_found'; end if;
end $$;

-- ---------------------------------------------------------------- earn
drop function record_earn(uuid, numeric, uuid, text, timestamptz);
create function record_earn(
  p_customer_id uuid,
  p_amount_fjd numeric,
  p_client_txn_id uuid,
  p_device_id text default null,
  p_occurred_at timestamptz default now(),
  p_qr_ts bigint default null,
  p_qr_sig text default null
) returns table (transaction_id uuid, points_earned integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  st staff := current_staff();
  mer merchants;
  rate numeric;
  pts integer;
  day_pts integer;
  existing transactions;
  new_id uuid;
  nonce text;
  day_start timestamptz := fiji_day_start(p_occurred_at);
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if p_client_txn_id is null then raise exception 'client_txn_id_required'; end if;

  -- Retry of a sale we already recorded: return it unchanged (before any other check).
  select * into existing from transactions where client_txn_id = p_client_txn_id;
  if found then
    if existing.merchant_id is distinct from st.merchant_id or existing.type <> 'earn'
       or existing.customer_id <> p_customer_id then
      raise exception 'client_txn_id_conflict';
    end if;
    return query select existing.id, existing.points_change, balance_of(existing.customer_id), true;
    return;
  end if;

  if p_amount_fjd is null or p_amount_fjd <= 0 then raise exception 'invalid_amount'; end if;
  if p_amount_fjd > setting_num('max_sale_fjd') then raise exception 'sale_exceeds_max'; end if;
  if p_occurred_at > now() + interval '5 minutes' then raise exception 'occurred_in_future'; end if;
  if p_occurred_at < now() - interval '7 days' then raise exception 'occurred_too_old'; end if;

  perform 1 from customers where id = p_customer_id and status = 'active' for update;
  if not found then raise exception 'customer_not_found'; end if;

  -- A QR proof is optional (cashiers may type a number) but, when given, it must be valid and unused.
  if p_qr_ts is not null or p_qr_sig is not null then
    perform verify_qr(p_customer_id, p_qr_ts, p_qr_sig, p_occurred_at);
    nonce := p_customer_id::text || ':' || p_qr_ts::text;
    if exists (select 1 from transactions where qr_nonce = nonce) then raise exception 'qr_already_used'; end if;
  end if;

  select * into mer from merchants where id = st.merchant_id;

  if (select count(*) from transactions
      where customer_id = p_customer_id and merchant_id = st.merchant_id and type = 'earn'
        and created_at > p_occurred_at - interval '1 hour' and created_at <= p_occurred_at)
     >= setting_num('max_scans_per_hour') then
    raise exception 'scan_limit_reached';
  end if;

  if (select count(*) from transactions
      where staff_id = st.id and type = 'earn'
        and created_at > p_occurred_at - interval '1 hour' and created_at <= p_occurred_at)
     >= setting_num('max_sales_per_till_per_hour') then
    raise exception 'till_rate_limit';
  end if;

  rate := least(greatest(mer.points_per_fjd, setting_num('min_points_per_fjd')), setting_num('max_points_per_fjd'));
  pts := floor(p_amount_fjd * rate)::integer;
  if pts < 1 then raise exception 'sale_too_small'; end if;

  select coalesce(sum(points_change), 0) into day_pts from transactions
   where customer_id = p_customer_id and type = 'earn'
     and created_at >= day_start and created_at < day_start + interval '1 day';
  if day_pts + pts > setting_num('max_daily_points_per_customer') then raise exception 'daily_limit_customer'; end if;

  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change,
                            expires_at, created_at, device_id, client_txn_id, sync_status, entry_method, qr_nonce)
  values (p_customer_id, st.merchant_id, st.id, 'earn', round(p_amount_fjd, 2), pts,
          p_occurred_at + make_interval(months => setting_num('points_expiry_months')::integer),
          p_occurred_at, p_device_id, p_client_txn_id, 'synced',
          case when nonce is null then 'manual' else 'qr' end, nonce)
  returning id into new_id;

  return query select new_id, pts, balance_of(p_customer_id), false;
end $$;

-- ---------------------------------------------------------------- redeem: daily cap
create or replace function create_redemption(p_reward_id uuid)
returns table (code char, expires_at timestamptz, points_cost integer, reward_title text, merchant_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid();
  rw rewards;
  mer merchants;
  open_code redemption_codes;
  new_code char(6);
  exp timestamptz;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  perform 1 from customers where id = me and status = 'active' for update;
  if not found then raise exception 'customer_not_found'; end if;

  select * into rw from rewards where id = p_reward_id;
  if not found then raise exception 'reward_not_found'; end if;
  select * into mer from merchants where id = rw.merchant_id and status = 'active';
  if not found then raise exception 'merchant_inactive'; end if;
  if rw.active_from > now() or (rw.active_to is not null and rw.active_to <= now()) then
    raise exception 'reward_not_active';
  end if;

  select * into open_code from redemption_codes rc
   where rc.customer_id = me and rc.reward_id = rw.id and rc.used_at is null and rc.expires_at > now();
  if found then
    return query select open_code.code, open_code.expires_at, open_code.points_cost, rw.title, mer.business_name;
    return;
  end if;

  if rw.daily_limit is not null and (
       select count(*) from redemption_codes rc
       where rc.reward_id = rw.id
         and (rc.used_at is not null or rc.expires_at > now())
         and rc.created_at >= fiji_day_start(now())
     ) >= rw.daily_limit then
    raise exception 'daily_limit_reached';
  end if;

  if (select count(*) from transactions where customer_id = me and type = 'redeem' and created_at >= fiji_day_start(now()))
     + (select count(*) from redemption_codes rc where rc.customer_id = me and rc.used_at is null and rc.expires_at > now())
     >= setting_num('max_redemptions_per_customer_per_day') then
    raise exception 'redeem_limit_reached';
  end if;

  if balance_of(me) - reserved_points(me) < rw.points_cost then raise exception 'insufficient_points'; end if;

  new_code := new_redemption_code(rw.merchant_id);
  exp := now() + make_interval(mins => setting_num('redeem_code_minutes')::integer);
  insert into redemption_codes (code, customer_id, merchant_id, reward_id, points_cost, expires_at)
  values (new_code, me, rw.merchant_id, rw.id, rw.points_cost, exp);

  return query select new_code, exp, rw.points_cost, rw.title, mer.business_name;
end $$;

-- ---------------------------------------------------------------- network admins and alerts
create table network_admins (user_id uuid primary key references auth.users (id) on delete cascade);
alter table network_admins enable row level security;     -- no policies: managed in the dashboard / by the service role

create function is_network_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from network_admins where user_id = auth.uid())
$$;

create table alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  merchant_id uuid references merchants (id),
  customer_id uuid references customers (id),
  staff_id uuid references staff (id),
  details jsonb not null default '{}',
  dedupe_key text not null unique,                 -- one alert per pattern per subject per day
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  handled_by uuid,
  handled_at timestamptz,
  note text
);
create index alerts_open_idx on alerts (created_at desc) where status = 'open';
alter table alerts enable row level security;
create policy alerts_admin_read on alerts for select to authenticated using (is_network_admin());
create trigger audit_alerts after insert or update on alerts for each row execute function audit_row_change();

-- Admins can see who and what an alert is about (but not customer secrets, which are in another table).
create policy customers_admin_read on customers for select to authenticated using (is_network_admin());
create policy merchants_admin_read on merchants for select to authenticated using (is_network_admin());
create policy staff_admin_read on staff for select to authenticated using (is_network_admin());

-- Looks back over the last day (hour for the burst rule) and records anything unusual.
-- Safe to run as often as you like: the same pattern on the same day is only recorded once.
create function detect_fraud(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare
  day_key text := to_char(p_now at time zone 'Pacific/Fiji', 'YYYY-MM-DD');
  since_day timestamptz := p_now - interval '24 hours';
  since_hour timestamptz := p_now - interval '1 hour';
  n integer; total integer := 0;
  near_cap numeric := setting_num('max_sale_fjd') * 0.9;
begin
  -- Several sales just under the FJD cap from one cashier login
  insert into alerts (kind, severity, merchant_id, staff_id, details, dedupe_key)
  select 'near_cap_sales', 'medium', merchant_id, staff_id,
         jsonb_build_object('sales', count(*), 'min_amount_fjd', min(amount_fjd), 'max_amount_fjd', max(amount_fjd)),
         'near_cap_sales:' || staff_id || ':' || day_key
  from transactions
  where type = 'earn' and created_at > since_day and created_at <= p_now and amount_fjd >= near_cap and staff_id is not null
  group by merchant_id, staff_id having count(*) >= 3
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- One customer earning at many different shops within an hour
  insert into alerts (kind, severity, customer_id, details, dedupe_key)
  select 'many_shops_hour', 'high', customer_id,
         jsonb_build_object('shops', count(distinct merchant_id), 'sales', count(*)),
         'many_shops_hour:' || customer_id || ':' || day_key
  from transactions
  where type = 'earn' and created_at > since_hour and created_at <= p_now
  group by customer_id having count(distinct merchant_id) >= 4
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- The same cashier and customer again and again
  insert into alerts (kind, severity, merchant_id, customer_id, staff_id, details, dedupe_key)
  select 'repeat_pair', 'medium', merchant_id, customer_id, staff_id,
         jsonb_build_object('sales', count(*), 'points', sum(points_change)),
         'repeat_pair:' || staff_id || ':' || customer_id || ':' || day_key
  from transactions
  where type = 'earn' and created_at > since_day and created_at <= p_now and staff_id is not null
  group by merchant_id, customer_id, staff_id having count(*) >= 6
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- A cashier earning points for their own phone number at their own shop
  insert into alerts (kind, severity, merchant_id, customer_id, staff_id, details, dedupe_key)
  select 'self_dealing', 'high', t.merchant_id, t.customer_id, t.staff_id,
         jsonb_build_object('sales', count(*), 'points', sum(t.points_change)),
         'self_dealing:' || t.staff_id || ':' || day_key
  from transactions t
  join staff s on s.id = t.staff_id
  join customers c on c.id = t.customer_id and c.phone = s.phone
  where t.type = 'earn' and t.created_at > since_day and t.created_at <= p_now
  group by t.merchant_id, t.customer_id, t.staff_id
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- A cashier who almost never scans the customer's QR
  insert into alerts (kind, severity, merchant_id, staff_id, details, dedupe_key)
  select 'mostly_manual_entry', 'low', merchant_id, staff_id,
         jsonb_build_object('sales', count(*), 'manual', count(*) filter (where entry_method = 'manual')),
         'mostly_manual_entry:' || staff_id || ':' || day_key
  from transactions
  where type = 'earn' and created_at > since_day and created_at <= p_now and staff_id is not null
  group by merchant_id, staff_id
  having count(*) >= 10 and count(*) filter (where entry_method = 'manual') >= 0.8 * count(*)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count; total := total + n;

  return total;
end $$;

-- ---------------------------------------------------------------- admin actions
create function admin_handle_alert(p_alert uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  if p_action not in ('dismissed', 'actioned') then raise exception 'invalid_action'; end if;
  update alerts set status = p_action, handled_by = auth.uid(), handled_at = now(), note = p_note where id = p_alert;
  if not found then raise exception 'alert_not_found'; end if;
end $$;

create function admin_set_customer_status(p_customer uuid, p_status customer_status, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  update customers set status = p_status where id = p_customer;
  if not found then raise exception 'customer_not_found'; end if;
  insert into audit_log (actor, action, table_name, row_id, details)
  values (auth.uid(), 'ADMIN_SET_STATUS', 'customers', p_customer::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;

create function admin_set_merchant_status(p_merchant uuid, p_status merchant_status, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  update merchants set status = p_status where id = p_merchant;
  if not found then raise exception 'merchant_not_found'; end if;
  insert into audit_log (actor, action, table_name, row_id, details)
  values (auth.uid(), 'ADMIN_SET_STATUS', 'merchants', p_merchant::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on function create_customer_secret() from public, anon;
revoke all on function fiji_day_start(timestamptz), qr_signature(uuid, bigint), verify_qr(uuid, bigint, text, timestamptz),
  server_time(), lookup_customer(uuid, text, bigint, text),
  record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text), create_redemption(uuid),
  is_network_admin(), detect_fraud(timestamptz), admin_handle_alert(uuid, text, text),
  admin_set_customer_status(uuid, customer_status, text), admin_set_merchant_status(uuid, merchant_status, text)
  from public, anon;

grant execute on function server_time(), lookup_customer(uuid, text, bigint, text),
  record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text), create_redemption(uuid),
  is_network_admin(), admin_handle_alert(uuid, text, text),
  admin_set_customer_status(uuid, customer_status, text), admin_set_merchant_status(uuid, merchant_status, text)
  to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function detect_fraud(timestamptz) to service_role;
  end if;
end $$;
