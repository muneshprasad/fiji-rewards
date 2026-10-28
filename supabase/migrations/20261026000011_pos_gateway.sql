-- POS gateway: lets a point-of-sale system (Fisko POS and others) credit, look up, redeem and refund points
-- for ITS OWN shop through a secret API key. The earn and redeem rules are the same ones the app uses:
-- they now live in two shared functions (earn_core, redeem_core) that both the app and the POS call.
-- Everything here is callable only by the service role (the Edge Function), never by app users.

create table merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants (id),
  name text not null,
  key_prefix text not null,                  -- first characters, to recognise a key; the key itself is never stored
  key_hash text not null unique,             -- SHA-256 of the key
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
alter table merchant_api_keys enable row level security;       -- no policies: not readable by app users
create trigger audit_merchant_api_keys after insert or update on merchant_api_keys for each row execute function audit_row_change();

alter table transactions
  add column channel text not null default 'app' check (channel in ('app', 'pos')),
  add column pos_key_id uuid references merchant_api_keys (id),
  add column refund_of uuid references transactions (id);       -- set on a refund, pointing at the sale it reverses
create index transactions_pos_key_idx on transactions (pos_key_id, created_at) where pos_key_id is not null;
create index transactions_refund_idx on transactions (refund_of) where refund_of is not null;

-- ---------------------------------------------------------------- shared rules
create function earn_core(
  p_merchant uuid, p_staff uuid, p_pos_key uuid,
  p_customer_id uuid, p_amount_fjd numeric, p_client_txn_id uuid, p_device_id text,
  p_occurred_at timestamptz, p_qr_ts bigint, p_qr_sig text, p_receipt_ref text, p_channel text
) returns table (transaction_id uuid, points_earned integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  mer merchants;
  rate numeric;
  pts integer;
  day_pts integer;
  existing transactions;
  new_id uuid;
  nonce text;
  ref text := nullif(upper(btrim(p_receipt_ref)), '');
  day_start timestamptz := fiji_day_start(p_occurred_at);
begin
  if p_client_txn_id is null then raise exception 'client_txn_id_required'; end if;

  -- Retry of a sale we already recorded: return it unchanged (before any other check).
  select * into existing from transactions where client_txn_id = p_client_txn_id;
  if found then
    if existing.merchant_id is distinct from p_merchant or existing.type <> 'earn'
       or existing.customer_id <> p_customer_id then
      raise exception 'client_txn_id_conflict';
    end if;
    return query select existing.id, existing.points_change, balance_of(existing.customer_id), true;
    return;
  end if;

  if p_amount_fjd is null or p_amount_fjd <= 0 then raise exception 'invalid_amount'; end if;
  if ref is not null and exists (select 1 from transactions where merchant_id = p_merchant and receipt_ref = ref) then
    raise exception 'receipt_already_claimed';
  end if;
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

  select * into mer from merchants where id = p_merchant;

  if (select count(*) from transactions
      where customer_id = p_customer_id and merchant_id = p_merchant and type = 'earn'
        and created_at > p_occurred_at - interval '1 hour' and created_at <= p_occurred_at)
     >= setting_num('max_scans_per_hour') then
    raise exception 'scan_limit_reached';
  end if;

  if (select count(*) from transactions
      where type = 'earn' and (case when p_pos_key is not null then pos_key_id = p_pos_key else staff_id = p_staff end)
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
                            expires_at, created_at, device_id, client_txn_id, sync_status, entry_method, qr_nonce, receipt_ref, channel, pos_key_id)
  values (p_customer_id, p_merchant, p_staff, 'earn', round(p_amount_fjd, 2), pts,
          p_occurred_at + make_interval(months => setting_num('points_expiry_months')::integer),
          p_occurred_at, p_device_id, p_client_txn_id, 'synced',
          case when nonce is null then 'manual' else 'qr' end, nonce, ref, p_channel, p_pos_key)
  returning id into new_id;

  return query select new_id, pts, balance_of(p_customer_id), false;
end $$;

create function redeem_core(p_merchant uuid, p_staff uuid, p_pos_key uuid, p_code text, p_client_txn_id uuid, p_device_id text, p_channel text)
returns table (transaction_id uuid, reward_title text, value_fjd numeric, points_spent integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  rc redemption_codes;
  rw rewards;
  existing transactions;
  new_id uuid;
begin
  if p_client_txn_id is null then raise exception 'client_txn_id_required'; end if;

  select * into existing from transactions where client_txn_id = p_client_txn_id;
  if found then
    if existing.type <> 'redeem' or existing.merchant_id is distinct from p_merchant then
      raise exception 'client_txn_id_conflict';
    end if;
    select * into rw from rewards r where r.id = (select rcx.reward_id from redemption_codes rcx where rcx.transaction_id = existing.id);
    return query select existing.id, rw.title, rw.value_fjd, -existing.points_change, balance_of(existing.customer_id), true;
    return;
  end if;

  select * into rc from redemption_codes
   where code = p_code and merchant_id = p_merchant and used_at is null
   order by created_at desc limit 1 for update;
  if not found then raise exception 'code_not_found_or_used'; end if;
  if rc.expires_at <= now() then raise exception 'code_expired'; end if;

  perform 1 from customers where id = rc.customer_id for update;   -- serialise with other spends
  if balance_of(rc.customer_id) < rc.points_cost then raise exception 'insufficient_points'; end if;

  select * into rw from rewards where id = rc.reward_id;

  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change,
                            note, device_id, client_txn_id, sync_status, channel, pos_key_id)
  values (rc.customer_id, p_merchant, p_staff, 'redeem', 0, -rc.points_cost,
          'redeemed: ' || rw.title, p_device_id, p_client_txn_id, 'synced', p_channel, p_pos_key)
  returning id into new_id;

  update redemption_codes set used_at = now(), transaction_id = new_id where id = rc.id;

  return query select new_id, rw.title, rw.value_fjd, rc.points_cost, balance_of(rc.customer_id), false;
end $$;

-- The app's cashier functions are now thin wrappers around the shared rules.
create or replace function record_earn(
  p_customer_id uuid, p_amount_fjd numeric, p_client_txn_id uuid, p_device_id text default null,
  p_occurred_at timestamptz default now(), p_qr_ts bigint default null, p_qr_sig text default null, p_receipt_ref text default null
) returns table (transaction_id uuid, points_earned integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  st staff := current_staff();
begin
  if st.id is null then raise exception 'not_staff'; end if;
  return query select * from earn_core(st.merchant_id, st.id, null, p_customer_id, p_amount_fjd, p_client_txn_id, p_device_id,
                                       p_occurred_at, p_qr_ts, p_qr_sig, p_receipt_ref, 'app');
end $$;

create or replace function confirm_redemption(p_code text, p_client_txn_id uuid, p_device_id text default null)
returns table (transaction_id uuid, reward_title text, value_fjd numeric, points_spent integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  st staff := current_staff();
begin
  if st.id is null then raise exception 'not_staff'; end if;
  return query select * from redeem_core(st.merchant_id, st.id, null, p_code, p_client_txn_id, p_device_id, 'app');
end $$;

-- ---------------------------------------------------------------- admin: create and revoke a shop's POS key
-- The key is shown ONCE, when it is created. Only its hash is kept.
create function admin_create_pos_key(p_merchant uuid, p_name text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := 'fjp_' || encode(gen_random_bytes(24), 'hex');
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  if not exists (select 1 from merchants where id = p_merchant) then raise exception 'merchant_not_found'; end if;
  insert into merchant_api_keys (merchant_id, name, key_prefix, key_hash)
  values (p_merchant, p_name, left(k, 8), encode(digest(k, 'sha256'), 'hex'));
  return k;
end $$;

-- The same, for the project owner working in the Supabase SQL editor (which is not "signed in" as an app user).
-- Not callable by app users or the API; only the database owner can run it.
create function create_pos_key(p_merchant uuid, p_name text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := 'fjp_' || encode(gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from merchants where id = p_merchant) then raise exception 'merchant_not_found'; end if;
  insert into merchant_api_keys (merchant_id, name, key_prefix, key_hash)
  values (p_merchant, p_name, left(k, 8), encode(digest(k, 'sha256'), 'hex'));
  return k;
end $$;

create function revoke_pos_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update merchant_api_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
  if not found then raise exception 'key_not_found'; end if;
end $$;

create function admin_revoke_pos_key(p_key_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  update merchant_api_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
  if not found then raise exception 'key_not_found'; end if;
end $$;

-- ---------------------------------------------------------------- the POS functions (service role only)
create function pos_auth(p_key text) returns table (merchant_id uuid, key_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  k merchant_api_keys;
begin
  select * into k from merchant_api_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'invalid_api_key'; end if;
  if not exists (select 1 from merchants m where m.id = k.merchant_id and m.status = 'active') then raise exception 'shop_inactive'; end if;
  update merchant_api_keys set last_used_at = now() where id = k.id;
  return query select k.merchant_id, k.id;
end $$;

-- a stable id from the shop and the POS's own document number, so a resend can never count twice
create function pos_txn_id(p_merchant uuid, p_kind text, p_ref text) returns uuid
language sql immutable as $$ select md5(p_merchant::text || ':' || p_kind || ':' || upper(btrim(p_ref)))::uuid $$;

create function pos_find_customer(p_customer_id uuid, p_phone text, p_qr_ts bigint, p_qr_sig text, p_at timestamptz, out cust uuid, out via_qr boolean)
language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is not null then
    perform verify_qr(p_customer_id, p_qr_ts, p_qr_sig, p_at);
    cust := p_customer_id; via_qr := true;
  elsif p_phone is not null then
    select c.id into cust from customers c where c.phone = p_phone and c.status = 'active';
    via_qr := false;
  else
    raise exception 'customer_required';
  end if;
  if cust is null or not exists (select 1 from customers where id = cust and status = 'active') then raise exception 'customer_not_found'; end if;
end $$;

create function pos_lookup(p_key text, p_customer_id uuid default null, p_phone text default null, p_qr_ts bigint default null, p_qr_sig text default null)
returns table (customer_id uuid, first_name text, balance integer)
language plpgsql security definer set search_path = public as $$
declare
  a record; f record;
begin
  select * into a from pos_auth(p_key);
  select * into f from pos_find_customer(p_customer_id, p_phone, p_qr_ts, p_qr_sig, now());
  return query select c.id, nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''), balance_of(c.id) from customers c where c.id = f.cust;
end $$;

create function pos_earn(
  p_key text, p_amount_fjd numeric, p_receipt_ref text,
  p_customer_id uuid default null, p_qr_ts bigint default null, p_qr_sig text default null, p_phone text default null,
  p_occurred_at timestamptz default now(), p_device_id text default null
) returns table (transaction_id uuid, points_earned integer, new_balance integer, duplicate boolean, first_name text)
language plpgsql security definer set search_path = public as $$
declare
  a record; f record; ref text := nullif(upper(btrim(p_receipt_ref)), ''); r record; nm text;
begin
  select * into a from pos_auth(p_key);
  if ref is null then raise exception 'receipt_ref_required'; end if;
  -- a resend of a sale we already have returns it unchanged, whatever the customer proof now says
  select t.id, t.customer_id into r from transactions t where t.client_txn_id = pos_txn_id(a.merchant_id, 'earn', ref);
  if found then
    -- only for the same customer: another customer using this receipt number gets an error, and no one else's name
    if p_customer_id is null and p_phone is null then raise exception 'customer_required'; end if;
    if r.customer_id is distinct from coalesce(p_customer_id, (select c.id from customers c where c.phone = p_phone)) then
      raise exception 'receipt_already_claimed';
    end if;
    select nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), '') into nm from customers c where c.id = r.customer_id;
    return query select r.id, (select t.points_change from transactions t where t.id = r.id), balance_of(r.customer_id), true, nm;
    return;
  end if;
  select * into f from pos_find_customer(p_customer_id, p_phone, p_qr_ts, p_qr_sig, p_occurred_at);
  select nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), '') into nm from customers c where c.id = f.cust;
  return query select e.transaction_id, e.points_earned, e.new_balance, e.duplicate, nm
    from earn_core(a.merchant_id, null, a.key_id, f.cust, p_amount_fjd, pos_txn_id(a.merchant_id, 'earn', ref), p_device_id,
                   p_occurred_at, case when f.via_qr then p_qr_ts end, case when f.via_qr then p_qr_sig end, ref, 'pos') e;
end $$;

create function pos_redeem(p_key text, p_code text, p_receipt_ref text, p_device_id text default null)
returns table (transaction_id uuid, reward_title text, value_fjd numeric, points_spent integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  a record; ref text := nullif(upper(btrim(p_receipt_ref)), '');
begin
  select * into a from pos_auth(p_key);
  if ref is null then raise exception 'receipt_ref_required'; end if;
  return query select * from redeem_core(a.merchant_id, null, a.key_id, p_code, pos_txn_id(a.merchant_id, 'redeem', ref || ':' || coalesce(p_code, '')), p_device_id, 'pos');
end $$;

-- Reverses the points of a returned or voided sale, in full or in part. p_refund_ref is the POS's own
-- credit-note / void number, so a resend of the same refund is recognised. The balance may go below zero if
-- the customer has already spent the points; they cannot redeem until it is positive again.
create function pos_refund(p_key text, p_receipt_ref text, p_refund_ref text, p_refund_amount numeric default null, p_reason text default null)
returns table (points_reversed integer, new_balance integer, already_done boolean)
language plpgsql security definer set search_path = public as $$
declare
  a record; ref text := nullif(upper(btrim(p_receipt_ref)), ''); rref text := nullif(upper(btrim(p_refund_ref)), '');
  sale transactions; prior transactions; done integer; remaining integer; pts integer;
begin
  select * into a from pos_auth(p_key);
  if ref is null then raise exception 'receipt_ref_required'; end if;
  if rref is null then raise exception 'refund_ref_required'; end if;

  select * into prior from transactions where client_txn_id = pos_txn_id(a.merchant_id, 'refund', rref);
  if found then
    return query select -prior.points_change, balance_of(prior.customer_id), true;
    return;
  end if;

  select * into sale from transactions where merchant_id = a.merchant_id and receipt_ref = ref and type = 'earn';
  if not found then raise exception 'receipt_not_found'; end if;

  select coalesce(-sum(points_change), 0) into done from transactions where refund_of = sale.id;
  remaining := sale.points_change - done;
  if remaining <= 0 then raise exception 'already_fully_refunded'; end if;

  if p_refund_amount is null then
    pts := remaining;
  else
    if p_refund_amount <= 0 then raise exception 'invalid_amount'; end if;
    pts := least(remaining, floor(p_refund_amount * sale.points_change / sale.amount_fjd)::integer);
  end if;
  if pts < 1 then raise exception 'refund_too_small'; end if;

  perform 1 from customers where id = sale.customer_id for update;
  insert into transactions (customer_id, merchant_id, type, amount_fjd, points_change, note, client_txn_id, sync_status, channel, pos_key_id, refund_of)
  values (sale.customer_id, a.merchant_id, 'adjust', coalesce(p_refund_amount, sale.amount_fjd), -pts,
          left('refund of receipt ' || ref || coalesce(': ' || p_reason, ''), 200), pos_txn_id(a.merchant_id, 'refund', rref), 'synced', 'pos', a.key_id, sale.id);
  return query select pts, balance_of(sale.customer_id), false;
end $$;

-- ---------------------------------------------------------------- settlement counts points net of refunds
create or replace function generate_settlement(p_month date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  start_ts timestamptz := m::timestamp at time zone 'Pacific/Fiji';
  end_ts timestamptz := (m + interval '1 month')::timestamp at time zone 'Pacific/Fiji';
  pv numeric := setting_num('point_value_fjd');
  fee numeric := setting_num('issue_fee_fjd_per_point');
  mfee numeric := setting_num('monthly_shop_fee_fjd');
  n integer;
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  if m >= (now() at time zone 'Pacific/Fiji')::date - ((extract(day from now() at time zone 'Pacific/Fiji'))::int - 1) + interval '1 month' then
    raise exception 'month_not_started';
  end if;

  insert into settlements (month, merchant_id, points_issued, points_redeemed, point_value, issue_fee_per_point,
                           issue_charge, reimbursement, monthly_fee, net_amount)
  select m, mer.id, coalesce(t.issued, 0), coalesce(t.redeemed, 0), pv, fee,
         round(coalesce(t.issued, 0) * fee, 2),
         round(coalesce(t.redeemed, 0) * pv, 2),
         case when mer.status = 'active' then mfee else 0 end,
         round(coalesce(t.issued, 0) * fee, 2) + (case when mer.status = 'active' then mfee else 0 end) - round(coalesce(t.redeemed, 0) * pv, 2)
  from merchants mer
  left join (
    select merchant_id,
           coalesce(sum(points_change) filter (where type = 'earn' or (type = 'adjust' and refund_of is not null)), 0)::integer as issued,
           coalesce(-sum(points_change) filter (where type = 'redeem'), 0)::integer as redeemed
    from transactions where created_at >= start_ts and created_at < end_ts and merchant_id is not null
    group by merchant_id) t on t.merchant_id = mer.id
  where mer.status = 'active' or t.merchant_id is not null
  on conflict (merchant_id, month) do update set
    points_issued = excluded.points_issued, points_redeemed = excluded.points_redeemed,
    point_value = excluded.point_value, issue_fee_per_point = excluded.issue_fee_per_point,
    issue_charge = excluded.issue_charge, reimbursement = excluded.reimbursement,
    monthly_fee = excluded.monthly_fee, net_amount = excluded.net_amount
  where settlements.status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function network_summary(p_month date)
returns table (
  month date, points_issued bigint, points_redeemed bigint, points_expired bigint,
  issue_charges numeric, reimbursements numeric, monthly_fees numeric,
  margin_on_issue numeric, breakage_value numeric, network_earnings numeric,
  cash_in numeric, cash_out numeric, net_cash numeric, outstanding_points bigint, outstanding_liability numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  start_ts timestamptz := m::timestamp at time zone 'Pacific/Fiji';
  end_ts timestamptz := (m + interval '1 month')::timestamp at time zone 'Pacific/Fiji';
  pv numeric := setting_num('point_value_fjd');
  fee numeric := setting_num('issue_fee_fjd_per_point');
  mfee numeric := setting_num('monthly_shop_fee_fjd');
  iss bigint; red bigint; exp bigint; fees numeric; outst bigint;
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  select coalesce(sum(points_change) filter (where type = 'earn' or (type = 'adjust' and refund_of is not null)), 0),
         coalesce(-sum(points_change) filter (where type = 'redeem'), 0),
         coalesce(-sum(points_change) filter (where type = 'expire'), 0)
    into iss, red, exp
    from transactions where created_at >= start_ts and created_at < end_ts;
  select count(*) * mfee into fees from merchants where status = 'active';
  select coalesce(sum(points_change), 0) into outst from transactions where created_at < end_ts;
  return query select m, iss, red, exp,
    round(iss * fee, 2), round(red * pv, 2), fees,
    round(iss * (fee - pv), 2), round(exp * pv, 2),
    round(iss * (fee - pv), 2) + fees + round(exp * pv, 2),
    round(iss * fee, 2) + fees, round(red * pv, 2),
    round(iss * fee, 2) + fees - round(red * pv, 2),
    outst, round(outst * pv, 2);
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on function earn_core(uuid, uuid, uuid, uuid, numeric, uuid, text, timestamptz, bigint, text, text, text),
  redeem_core(uuid, uuid, uuid, text, uuid, text, text), pos_auth(text), pos_txn_id(uuid, text, text),
  pos_find_customer(uuid, text, bigint, text, timestamptz), pos_lookup(text, uuid, text, bigint, text),
  pos_earn(text, numeric, text, uuid, bigint, text, text, timestamptz, text), pos_redeem(text, text, text, text),
  pos_refund(text, text, text, numeric, text), admin_create_pos_key(uuid, text), admin_revoke_pos_key(uuid),
  create_pos_key(uuid, text), revoke_pos_key(uuid)
  from public, anon, authenticated;

grant execute on function admin_create_pos_key(uuid, text), admin_revoke_pos_key(uuid) to authenticated;
grant execute on function record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text, text), confirm_redemption(text, uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function pos_lookup(text, uuid, text, bigint, text), pos_earn(text, numeric, text, uuid, bigint, text, text, timestamptz, text),
      pos_redeem(text, text, text, text), pos_refund(text, text, text, numeric, text) to service_role;
  end if;
end $$;
