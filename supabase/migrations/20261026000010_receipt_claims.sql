-- Receipt claims: a customer scans the QR code printed on a VMS (VAT Monitoring System) receipt to claim points.
-- This migration is the rules only. It does not depend on what is inside the QR code: the app reads the
-- shop's tax number, the receipt number, the amount and the time from it, and the server decides whether
-- to credit the points. A receipt can be claimed once per shop, whether by the customer or by a cashier.

alter table merchants add column tin text unique check (tin is null or tin ~ '^[0-9]{6,15}$');   -- the shop's tax number, digits only
alter table transactions add column receipt_ref text, add column receipt_at timestamptz;
create unique index transactions_receipt_once on transactions (merchant_id, receipt_ref) where receipt_ref is not null;

alter table transactions drop constraint transactions_entry_method_check;
alter table transactions add constraint transactions_entry_method_check
  check (entry_method in ('qr', 'manual', 'receipt', 'receipt_typed'));

insert into network_settings (key, value, description) values
  ('receipt_claim_hours',            24,  'A receipt can be claimed up to this many hours after it was printed'),
  ('receipt_typed_max_fjd',          100, 'Largest receipt claimed with a typed-in amount (not read from the QR code)'),
  ('max_receipt_claims_per_hour',    5,   'Most receipts one customer can claim in an hour');

-- ---------------------------------------------------------------- cashier flow also records the receipt number
drop function record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text);
create function record_earn(
  p_customer_id uuid,
  p_amount_fjd numeric,
  p_client_txn_id uuid,
  p_device_id text default null,
  p_occurred_at timestamptz default now(),
  p_qr_ts bigint default null,
  p_qr_sig text default null,
  p_receipt_ref text default null
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
  ref text := nullif(upper(btrim(p_receipt_ref)), '');
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
  if ref is not null and exists (select 1 from transactions where merchant_id = st.merchant_id and receipt_ref = ref) then
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
                            expires_at, created_at, device_id, client_txn_id, sync_status, entry_method, qr_nonce, receipt_ref)
  values (p_customer_id, st.merchant_id, st.id, 'earn', round(p_amount_fjd, 2), pts,
          p_occurred_at + make_interval(months => setting_num('points_expiry_months')::integer),
          p_occurred_at, p_device_id, p_client_txn_id, 'synced',
          case when nonce is null then 'manual' else 'qr' end, nonce, ref)
  returning id into new_id;

  return query select new_id, pts, balance_of(p_customer_id), false;
end $$;

-- ---------------------------------------------------------------- the customer's claim
create function claim_receipt(
  p_tin text,                         -- the shop's tax number, as printed in the QR code
  p_receipt_ref text,                 -- the receipt / invoice number
  p_amount_fjd numeric,
  p_receipt_at timestamptz,           -- when the receipt was printed
  p_amount_from_qr boolean default true
) returns table (transaction_id uuid, points_earned integer, new_balance integer, shop_name text, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  digits text := regexp_replace(coalesce(p_tin, ''), '[^0-9]', '', 'g');
  ref text := nullif(upper(btrim(p_receipt_ref)), '');
  mer merchants;
  existing transactions;
  rate numeric;
  pts integer;
  day_pts integer;
  day_start timestamptz := fiji_day_start(now());
  new_id uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if ref is null or length(ref) > 64 then raise exception 'receipt_invalid'; end if;

  select * into mer from merchants where tin = digits and status = 'active';
  if not found then raise exception 'unknown_shop'; end if;

  -- The same customer claiming the same receipt again (a lost reply) just gets the saved result back.
  select * into existing from transactions where merchant_id = mer.id and receipt_ref = ref;
  if found then
    if existing.customer_id = me then
      return query select existing.id, existing.points_change, balance_of(me), mer.business_name, true;
      return;
    end if;
    raise exception 'receipt_already_claimed';
  end if;

  if p_amount_fjd is null or p_amount_fjd <= 0 then raise exception 'invalid_amount'; end if;
  if p_amount_fjd > setting_num('max_sale_fjd') then raise exception 'sale_exceeds_max'; end if;
  if not p_amount_from_qr and p_amount_fjd > setting_num('receipt_typed_max_fjd') then raise exception 'typed_amount_too_large'; end if;
  if p_receipt_at is null or p_receipt_at > now() + interval '5 minutes' then raise exception 'receipt_invalid'; end if;
  if p_receipt_at < now() - make_interval(hours => setting_num('receipt_claim_hours')::integer) then raise exception 'receipt_too_old'; end if;

  perform 1 from customers where id = me and status = 'active' for update;
  if not found then raise exception 'customer_not_found'; end if;

  -- A shop's own staff cannot earn points on their own shop's receipts.
  if exists (select 1 from staff s join customers c on c.phone = s.phone where c.id = me and s.merchant_id = mer.id and s.active) then
    raise exception 'cannot_claim_own_shop';
  end if;

  if (select count(*) from transactions where customer_id = me and entry_method in ('receipt', 'receipt_typed') and created_at > now() - interval '1 hour')
     >= setting_num('max_receipt_claims_per_hour') then
    raise exception 'claim_limit_reached';
  end if;

  rate := least(greatest(mer.points_per_fjd, setting_num('min_points_per_fjd')), setting_num('max_points_per_fjd'));
  pts := floor(p_amount_fjd * rate)::integer;
  if pts < 1 then raise exception 'sale_too_small'; end if;

  select coalesce(sum(points_change), 0) into day_pts from transactions
   where customer_id = me and type = 'earn' and created_at >= day_start and created_at < day_start + interval '1 day';
  if day_pts + pts > setting_num('max_daily_points_per_customer') then raise exception 'daily_limit_customer'; end if;

  begin
    insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change, expires_at,
                              entry_method, receipt_ref, receipt_at, note)
    values (me, mer.id, null, 'earn', round(p_amount_fjd, 2), pts,
            now() + make_interval(months => setting_num('points_expiry_months')::integer),
            case when p_amount_from_qr then 'receipt' else 'receipt_typed' end, ref, p_receipt_at, 'receipt claim')
    returning id into new_id;
  exception when unique_violation then
    raise exception 'receipt_already_claimed';     -- two people scanning at the same moment: one wins
  end;

  return query select new_id, pts, balance_of(me), mer.business_name, false;
end $$;

revoke all on function claim_receipt(text, text, numeric, timestamptz, boolean),
  record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text, text) from public, anon;
grant execute on function claim_receipt(text, text, numeric, timestamptz, boolean),
  record_earn(uuid, numeric, uuid, text, timestamptz, bigint, text, text) to authenticated;
