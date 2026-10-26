-- Build step 3: transactions engine (earn, redeem, expire, balance).
-- Clients have no direct write access to transactions or redemption_codes; every
-- change goes through these functions, which enforce the network rules and only
-- ever append to the ledger. Errors use short codes in the message so apps can map them.

-- ---------------------------------------------------------------- helpers
create function setting_num(p_key text) returns numeric
language sql stable as $$ select value from network_settings where key = p_key $$;

create function balance_of(p_customer uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points_change), 0)::integer from transactions where customer_id = p_customer
$$;

-- The caller's active staff row (cashier or manager) at an active merchant.
create function current_staff() returns staff
language sql stable security definer set search_path = public as $$
  select s.* from staff s join merchants m on m.id = s.merchant_id
  where s.user_id = auth.uid() and s.active and m.status = 'active'
$$;

-- ---------------------------------------------------------------- customer lookup (till)
-- Staff identify a customer by QR (customer id) or by typing the phone number.
create function lookup_customer(p_customer_id uuid default null, p_phone text default null)
returns table (customer_id uuid, name text, phone text, balance integer)
language plpgsql stable security definer set search_path = public as $$
declare
  st staff := current_staff();
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if p_customer_id is null and p_phone is null then raise exception 'lookup_needs_id_or_phone'; end if;
  return query
    select c.id, c.name, c.phone, balance_of(c.id)
    from customers c
    where c.status = 'active'
      and (c.id = p_customer_id or c.phone = p_phone);
  if not found then raise exception 'customer_not_found'; end if;
end $$;

-- ---------------------------------------------------------------- earn
-- p_occurred_at lets the offline queue record when the sale really happened.
-- p_client_txn_id makes retries safe: the same id never earns twice.
create function record_earn(
  p_customer_id uuid,
  p_amount_fjd numeric,
  p_client_txn_id uuid,
  p_device_id text default null,
  p_occurred_at timestamptz default now()
) returns table (transaction_id uuid, points_earned integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  st staff := current_staff();
  mer merchants;
  rate numeric;
  pts integer;
  existing transactions;
  new_id uuid;
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if p_client_txn_id is null then raise exception 'client_txn_id_required'; end if;

  -- Retry of a sale we already recorded: return it unchanged.
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

  select * into mer from merchants where id = st.merchant_id;

  if (select count(*) from transactions
      where customer_id = p_customer_id and merchant_id = st.merchant_id and type = 'earn'
        and created_at > p_occurred_at - interval '1 hour' and created_at <= p_occurred_at)
     >= setting_num('max_scans_per_hour') then
    raise exception 'scan_limit_reached';
  end if;

  -- Merchant rate, kept inside the network's limits.
  rate := least(greatest(mer.points_per_fjd, setting_num('min_points_per_fjd')), setting_num('max_points_per_fjd'));
  pts := floor(p_amount_fjd * rate)::integer;
  if pts < 1 then raise exception 'sale_too_small'; end if;

  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change,
                            expires_at, created_at, device_id, client_txn_id, sync_status)
  values (p_customer_id, st.merchant_id, st.id, 'earn', round(p_amount_fjd, 2), pts,
          p_occurred_at + make_interval(months => setting_num('points_expiry_months')::integer),
          p_occurred_at, p_device_id, p_client_txn_id, 'synced')
  returning id into new_id;

  return query select new_id, pts, balance_of(p_customer_id), false;
end $$;

-- ---------------------------------------------------------------- redemption codes (customer)
create function new_redemption_code(p_merchant uuid) returns char
language plpgsql volatile security definer set search_path = public as $$
declare
  c char(6);
begin
  for i in 1..50 loop
    c := lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    if not exists (select 1 from redemption_codes where merchant_id = p_merchant and code = c and used_at is null) then
      return c;
    end if;
  end loop;
  raise exception 'code_generation_failed';
end $$;

-- Points held by this customer's unused, unexpired codes. Counting them stops
-- a customer from creating several codes that together exceed the balance.
create function reserved_points(p_customer uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points_cost), 0)::integer from redemption_codes
  where customer_id = p_customer and used_at is null and expires_at > now()
$$;

create function create_redemption(p_reward_id uuid)
returns table (code char, expires_at timestamptz, points_cost integer, reward_title text, merchant_name text)
language plpgsql security definer set search_path = public as $$
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

  -- Same customer asking again for the same reward gets the code they already have.
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
         and rc.created_at >= date_trunc('day', now() at time zone 'Pacific/Fiji') at time zone 'Pacific/Fiji'
     ) >= rw.daily_limit then
    raise exception 'daily_limit_reached';
  end if;

  if balance_of(me) - reserved_points(me) < rw.points_cost then raise exception 'insufficient_points'; end if;

  new_code := new_redemption_code(rw.merchant_id);
  exp := now() + make_interval(mins => setting_num('redeem_code_minutes')::integer);
  insert into redemption_codes (code, customer_id, merchant_id, reward_id, points_cost, expires_at)
  values (new_code, me, rw.merchant_id, rw.id, rw.points_cost, exp);

  return query select new_code, exp, rw.points_cost, rw.title, mer.business_name;
end $$;

-- ---------------------------------------------------------------- redeem (till)
-- Single use: the code row is locked, checked and marked used in one transaction.
-- Needs a connection; the balance is re-checked here against the real ledger.
create function confirm_redemption(p_code text, p_client_txn_id uuid, p_device_id text default null)
returns table (transaction_id uuid, reward_title text, value_fjd numeric, points_spent integer, new_balance integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  st staff := current_staff();
  rc redemption_codes;
  rw rewards;
  existing transactions;
  new_id uuid;
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if p_client_txn_id is null then raise exception 'client_txn_id_required'; end if;

  select * into existing from transactions where client_txn_id = p_client_txn_id;
  if found then
    if existing.type <> 'redeem' or existing.merchant_id is distinct from st.merchant_id then
      raise exception 'client_txn_id_conflict';
    end if;
    select * into rw from rewards r where r.id = (select rcx.reward_id from redemption_codes rcx where rcx.transaction_id = existing.id);
    return query select existing.id, rw.title, rw.value_fjd, -existing.points_change, balance_of(existing.customer_id), true;
    return;
  end if;

  select * into rc from redemption_codes
   where code = p_code and merchant_id = st.merchant_id and used_at is null
   order by created_at desc limit 1 for update;
  if not found then raise exception 'code_not_found_or_used'; end if;
  if rc.expires_at <= now() then raise exception 'code_expired'; end if;

  perform 1 from customers where id = rc.customer_id for update;   -- serialise with other spends
  if balance_of(rc.customer_id) < rc.points_cost then raise exception 'insufficient_points'; end if;

  select * into rw from rewards where id = rc.reward_id;

  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change,
                            note, device_id, client_txn_id, sync_status)
  values (rc.customer_id, st.merchant_id, st.id, 'redeem', 0, -rc.points_cost,
          'redeemed: ' || rw.title, p_device_id, p_client_txn_id, 'synced')
  returning id into new_id;

  update redemption_codes set used_at = now(), transaction_id = new_id where id = rc.id;

  return query select new_id, rw.title, rw.value_fjd, rc.points_cost, balance_of(rc.customer_id), false;
end $$;

-- ---------------------------------------------------------------- expire (scheduled job)
-- Spending uses the oldest points first (FIFO). For each customer, the amount past
-- its expiry date that is still unspent = expired lots minus all outflow so far.
-- Running it twice in a row does nothing the second time.
create function expire_points(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  total integer := 0;
begin
  for r in
    select customer_id,
           sum(points_change) filter (where points_change > 0 and expires_at is not null and expires_at <= p_now)
             + sum(points_change) filter (where points_change < 0) as to_expire
    from transactions
    group by customer_id
    having coalesce(sum(points_change) filter (where points_change > 0 and expires_at is not null and expires_at <= p_now), 0)
         + coalesce(sum(points_change) filter (where points_change < 0), 0) > 0
  loop
    insert into transactions (customer_id, type, points_change, note, created_at)
    values (r.customer_id, 'expire', -r.to_expire::integer, 'points expired', p_now);
    total := total + r.to_expire::integer;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on function lookup_customer(uuid, text), record_earn(uuid, numeric, uuid, text, timestamptz),
  create_redemption(uuid), confirm_redemption(text, uuid, text), expire_points(timestamptz),
  balance_of(uuid), current_staff(), reserved_points(uuid), new_redemption_code(uuid), setting_num(text)
  from public, anon;

grant execute on function lookup_customer(uuid, text), record_earn(uuid, numeric, uuid, text, timestamptz),
  create_redemption(uuid), confirm_redemption(text, uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function expire_points(timestamptz) to service_role;
  end if;
end $$;
