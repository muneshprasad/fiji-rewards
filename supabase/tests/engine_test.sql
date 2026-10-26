\set ON_ERROR_STOP on
-- Step 3 engine tests. Run after migrations, seed, and the other tests.

create function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, true) $$;

-- true if running the statement raises an error whose message contains p_msg
create function pg_temp.fails_with(stmt text, p_msg text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  if sqlerrm like '%' || p_msg || '%' then return true; end if;
  raise exception 'expected error % but got: %', p_msg, sqlerrm;
end $$;

do $$
declare
  m1 uuid := '00000000-0000-4000-8000-000000000001';  -- rate 1,   Bakehouse
  m2 uuid := '00000000-0000-4000-8000-000000000002';  -- rate 1,   Pharmacy
  m3 uuid := '00000000-0000-4000-8000-000000000003';  -- rate 1.5, Fresh Market
  cu1 uuid := gen_random_uuid(); cu2 uuid := gen_random_uuid(); cu3 uuid := gen_random_uuid(); cu4 uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid();
  r record;
  rw50 uuid; rw150 uuid; rw40 uuid;
  v_code text; v_code2 text;
  tx uuid;
begin
  insert into auth.users (id, phone) values (cu1,'6797400001'), (cu2,'6797400002'), (cu3,'6797400003'), (cu4,'6797400004');
  -- each customer starts with the 20-point welcome bonus
  insert into staff (merchant_id, user_id, name, phone) values
    (m1, null, 'Cashier 1', '+6797500001'), (m2, null, 'Cashier 2', '+6797500002'), (m3, null, 'Cashier 3', '+6797500003');
  insert into auth.users (id, phone) values (st1,'6797500001'), (st2,'6797500002'), (st3,'6797500003');  -- links staff

  select id into rw50  from rewards where merchant_id = m1 and points_cost = 50;
  select id into rw150 from rewards where merchant_id = m1 and points_cost = 150;
  select id into rw40  from rewards where merchant_id = m3 and points_cost = 40;

  ---------------------------------------------------------------- earn
  perform pg_temp.as_user(cu1);
  assert pg_temp.fails_with($q$select * from record_earn(gen_random_uuid(), 10, gen_random_uuid())$q$, 'not_staff'), 'customers cannot earn';

  perform pg_temp.as_user(st1);
  select * into r from record_earn(cu1, 30, '00000000-0000-4000-8000-0000000000a1', 'till-1');
  assert r.points_earned = 30 and r.new_balance = 50 and not r.duplicate, 'earn 30 at rate 1 -> 30 pts, balance 50';
  tx := r.transaction_id;

  select * into r from record_earn(cu1, 30, '00000000-0000-4000-8000-0000000000a1', 'till-1');
  assert r.duplicate and r.transaction_id = tx and r.new_balance = 50, 'retry is idempotent';
  assert (select count(*) from transactions where client_txn_id = '00000000-0000-4000-8000-0000000000a1') = 1;

  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu2 || $q$', 30, '00000000-0000-4000-8000-0000000000a1')$q$, 'client_txn_id_conflict');
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 501, gen_random_uuid())$q$, 'sale_exceeds_max');
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 0, gen_random_uuid())$q$, 'invalid_amount');
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 0.5, gen_random_uuid())$q$, 'sale_too_small');
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 5, gen_random_uuid(), null, now() + interval '1 hour')$q$, 'occurred_in_future');
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 5, gen_random_uuid(), null, now() - interval '8 days')$q$, 'occurred_too_old');
  assert pg_temp.fails_with($q$select * from record_earn(gen_random_uuid(), 5, gen_random_uuid())$q$, 'customer_not_found');

  -- scan limit: 3 per hour per customer per merchant (one already used)
  perform record_earn(cu1, 5, gen_random_uuid());
  perform record_earn(cu1, 5, gen_random_uuid());
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cu1 || $q$', 5, gen_random_uuid())$q$, 'scan_limit_reached');
  -- a different merchant has its own limit
  perform pg_temp.as_user(st3);
  select * into r from record_earn(cu1, 7, gen_random_uuid());
  assert r.points_earned = 10, 'rate 1.5 on FJD 7 = 10.5 -> floor 10';

  -- offline sale from 3 hours ago is accepted and keeps its own timestamp and expiry
  perform pg_temp.as_user(st1);
  select * into r from record_earn(cu2, 20, gen_random_uuid(), 'till-offline', now() - interval '3 hours');
  assert (select created_at from transactions where id = r.transaction_id) < now() - interval '2 hours 59 minutes';
  assert (select expires_at from transactions where id = r.transaction_id) < now() - interval '3 hours' + interval '12 months' + interval '1 minute';

  -- a till that was offline for almost 7 days: the old sale is accepted once, and re-sending it changes nothing
  select * into r from record_earn(cu4, 40, '00000000-0000-4000-8000-0000000000c1', 'till-offline', now() - interval '6 days 23 hours');
  assert r.points_earned = 40 and not r.duplicate, 'sale from just under 7 days ago is accepted';
  assert (select expires_at from transactions where id = r.transaction_id) < now() - interval '6 days' + interval '12 months' + interval '1 hour', 'expiry counts from the sale time';
  select * into r from record_earn(cu4, 40, '00000000-0000-4000-8000-0000000000c1', 'till-offline', now() - interval '6 days 23 hours');
  assert r.duplicate and r.new_balance = 20 + 40, 'a re-sent offline sale is a duplicate';
  assert (select count(*) from transactions where customer_id = cu4 and type = 'earn') = 1, 'only one sale was recorded';

  -- balance equals the ledger
  assert balance_of(cu1) = 20 + 30 + 5 + 5 + 10, 'cu1 balance sums the ledger';

  ---------------------------------------------------------------- lookup
  select * into r from lookup_customer(p_phone => '+6797400001');
  assert r.customer_id = cu1 and r.balance = 70, 'lookup by phone';
  assert pg_temp.fails_with($q$select * from lookup_customer('$q$ || gen_random_uuid() || $q$')$q$, 'customer_not_found');
  perform pg_temp.as_user(cu1);
  assert pg_temp.fails_with($q$select * from lookup_customer(null, '+6797400001')$q$, 'not_staff');

  ---------------------------------------------------------------- redeem
  -- cu1 has 70 points: reward costing 50 is OK, 150 is not
  perform pg_temp.as_user(cu1);
  assert pg_temp.fails_with($q$select * from create_redemption('$q$ || rw150 || $q$')$q$, 'insufficient_points');
  select * into r from create_redemption(rw50);
  v_code := r.code;
  assert v_code ~ '^[0-9]{6}$' and r.expires_at <= now() + interval '10 minutes' + interval '5 seconds';
  select * into r from create_redemption(rw50);
  assert r.code = v_code, 'same reward returns the same open code';
  -- 20 points left unreserved: another 50-pt reward at m3 (40 pts) must fail
  assert pg_temp.fails_with($q$select * from create_redemption('$q$ || rw40 || $q$')$q$, 'insufficient_points'), 'reserved points count';

  -- wrong merchant cannot use it
  perform pg_temp.as_user(st2);
  assert pg_temp.fails_with($q$select * from confirm_redemption('$q$ || v_code || $q$', gen_random_uuid())$q$, 'code_not_found_or_used');
  -- right merchant can, once
  perform pg_temp.as_user(st1);
  select * into r from confirm_redemption(v_code, '00000000-0000-4000-8000-0000000000b1');
  assert r.points_spent = 50 and r.new_balance = 20 and not r.duplicate, 'redeem spends 50';
  select * into r from confirm_redemption(v_code, '00000000-0000-4000-8000-0000000000b1');
  assert r.duplicate and r.new_balance = 20, 'retry of the same confirm is safe';
  assert pg_temp.fails_with($q$select * from confirm_redemption('$q$ || v_code || $q$', gen_random_uuid())$q$, 'code_not_found_or_used'), 'single use';
  assert balance_of(cu1) = 20;

  -- expiry of an unused code
  perform pg_temp.as_user(cu2);   -- cu2 has 20 + 20 = 40 points
  select * into r from create_redemption(rw40);   -- rw40 is at m3, cost 40
  v_code2 := r.code;
  update redemption_codes set expires_at = now() - interval '1 minute', created_at = now() - interval '11 minutes' where code = v_code2 and customer_id = cu2;
  perform pg_temp.as_user(st3);
  assert pg_temp.fails_with($q$select * from confirm_redemption('$q$ || v_code2 || $q$', gen_random_uuid())$q$, 'code_expired');

  -- direct writes are refused for signed-in users
  perform pg_temp.as_user(cu2);
  assert not has_function_privilege('authenticated', 'expire_points(timestamptz)', 'execute'), 'clients cannot expire points';

  ---------------------------------------------------------------- expire (FIFO)
  -- cu3: lot A 50 (already expired), lot B 30 (valid); spend 20 -> consumes lot A first
  delete from transactions where false;  -- (append-only: no cleanup possible, use fresh customer)
  insert into transactions (customer_id, merchant_id, type, points_change, expires_at, created_at) values
    (cu3, m1, 'earn', 50, now() - interval '1 day', now() - interval '13 months'),
    (cu3, m1, 'earn', 30, now() + interval '6 months', now() - interval '6 months'),
    (cu3, m1, 'redeem', -20, null, now() - interval '1 month');
  -- cu3 also has the 20-point welcome bonus (valid for ~12 months): balance 80 before expiry
  assert balance_of(cu3) = 20 + 50 + 30 - 20;
  perform expire_points();
  assert balance_of(cu3) = 20 + 30, 'expired lot A remainder (50-20=30) removed -> 50 left';
  assert (select points_change from transactions where customer_id = cu3 and type = 'expire') = -30;
  perform expire_points();
  assert (select count(*) from transactions where customer_id = cu3 and type = 'expire') = 1, 'expire is idempotent';

  -- customers are never driven below zero by expiry
  assert not exists (select 1 from customer_balances where balance < 0), 'no negative balances';
  raise notice 'engine tests passed';
end $$;
