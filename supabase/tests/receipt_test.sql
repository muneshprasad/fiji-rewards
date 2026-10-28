\set ON_ERROR_STOP on
create function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, true) $$;
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
  m5 uuid := '00000000-0000-4000-8000-000000000005';   -- Palm Coffee Co, rate 2
  m6 uuid := '00000000-0000-4000-8000-000000000006';   -- rate 1
  ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); cs uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  cashier uuid := gen_random_uuid(); r record; tx uuid; bal int;
begin
  update merchants set tin = '501234567' where id = m5;
  update merchants set tin = '509999999' where id = m6;
  -- a cashier at shop 5 who is also a customer (for the own-shop rule)
  insert into staff (merchant_id, name, phone, role) values (m5, 'Own Staff', '+6797960005', 'cashier');
  insert into auth.users (id, phone) values (ca, '6797960001'), (cb, '6797960002'), (cs, '6797960005'), (cl, '6797960006'), (cashier, '6797960007');
  insert into staff (merchant_id, name, phone, role) values (m5, 'Till Five', '+6797960007', 'cashier');   -- linked on insert: the login already exists

  -- a good claim: tax number may be written with dashes and spaces; receipt number is not case sensitive
  perform pg_temp.as_user(ca);
  select * into r from claim_receipt('50-1234 567', ' inv-0001 ', 20, now() - interval '30 minutes');
  assert r.points_earned = 40 and r.shop_name = 'Palm Coffee Co' and not r.duplicate, 'FJD 20 at rate 2 = 40 points';
  assert r.new_balance = 20 + 40, 'welcome bonus plus the claim';
  tx := r.transaction_id;
  assert (select entry_method from transactions where id = tx) = 'receipt';
  assert (select receipt_ref from transactions where id = tx) = 'INV-0001';
  assert (select staff_id from transactions where id = tx) is null;

  -- the same customer again (lost reply): same result, no extra points
  select * into r from claim_receipt('501234567', 'INV-0001', 20, now() - interval '30 minutes');
  assert r.duplicate and r.transaction_id = tx and r.new_balance = 60, 'a repeat by the same customer returns the saved claim';

  -- someone else cannot claim it
  perform pg_temp.as_user(cb);
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'inv-0001', 20, now())$q$, 'receipt_already_claimed');

  -- a cashier cannot also earn on it, and a cashier-entered receipt cannot be claimed afterwards
  perform pg_temp.as_user(cashier);
  assert pg_temp.fails_with($q$select * from record_earn('$q$ || cb || $q$', 20, gen_random_uuid(), null, now(), null, null, 'INV-0001')$q$, 'receipt_already_claimed');
  select * into r from record_earn(cb, 15, gen_random_uuid(), 'till', now(), null, null, 'inv-0002');
  assert r.points_earned = 30, 'cashier sale points: ' || coalesce(r.points_earned::text, 'null') || ' dup=' || coalesce(r.duplicate::text,'null');
  -- the customer the cashier credited scans the same receipt: told it is already counted, no extra points
  perform pg_temp.as_user(cb);
  select * into r from claim_receipt('501234567', 'INV-0002', 15, now());
  assert r.duplicate and r.points_earned = 30 and r.new_balance = 20 + 30, 'already counted, balance unchanged';
  -- and someone else cannot take a receipt the cashier already credited
  perform pg_temp.as_user(ca);
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'INV-0002', 15, now())$q$, 'receipt_already_claimed');
  perform pg_temp.as_user(cb);

  -- the same receipt number at a different shop is a different receipt
  select * into r from claim_receipt('509999999', 'INV-0001', 12, now());
  assert r.points_earned = 12 and r.shop_name is not null;

  -- shop and receipt checks
  assert pg_temp.fails_with($q$select * from claim_receipt('111111111', 'X1', 10, now())$q$, 'unknown_shop');
  assert pg_temp.fails_with($q$select * from claim_receipt('', 'X1', 10, now())$q$, 'unknown_shop');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', '  ', 10, now())$q$, 'receipt_invalid');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X2', 10, now() + interval '1 hour')$q$, 'receipt_invalid');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X3', 10, now() - interval '25 hours')$q$, 'receipt_too_old');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X4', 0, now())$q$, 'invalid_amount');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X5', 501, now())$q$, 'sale_exceeds_max');
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X6', 0.2, now())$q$, 'sale_too_small');

  -- an amount typed by the customer (not read from the QR) is held to a lower limit
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'X7', 150, now(), false)$q$, 'typed_amount_too_large');
  select * into r from claim_receipt('501234567', 'X8', 40, now(), false);
  assert (select entry_method from transactions where id = r.transaction_id) = 'receipt_typed';

  -- a shop's own staff cannot claim their shop's receipts, but can claim other shops'
  perform pg_temp.as_user(cs);
  assert pg_temp.fails_with($q$select * from claim_receipt('501234567', 'S1', 10, now())$q$, 'cannot_claim_own_shop');
  select * into r from claim_receipt('509999999', 'S2', 10, now());
  assert r.points_earned = 10, 'staff may claim receipts from other shops';

  -- limits (lowered for the test, then restored)
  perform pg_temp.as_user(cl);
  update network_settings set value = 2 where key = 'max_receipt_claims_per_hour';
  perform claim_receipt('509999999', 'L1', 5, now());
  perform claim_receipt('509999999', 'L2', 5, now());
  assert pg_temp.fails_with($q$select * from claim_receipt('509999999', 'L3', 5, now())$q$, 'claim_limit_reached');
  update network_settings set value = 5 where key = 'max_receipt_claims_per_hour';

  update network_settings set value = 30 where key = 'max_daily_points_per_customer';
  assert pg_temp.fails_with($q$select * from claim_receipt('509999999', 'L4', 25, now())$q$, 'daily_limit_customer');
  update network_settings set value = 1000 where key = 'max_daily_points_per_customer';

  -- a shop without a tax number on file cannot take receipt claims
  update merchants set tin = null where id = m6;
  assert pg_temp.fails_with($q$select * from claim_receipt('509999999', 'N1', 10, now())$q$, 'unknown_shop');
  update merchants set tin = '509999999' where id = m6;

  -- suspended shops and customers
  update merchants set status = 'suspended' where id = m6;
  assert pg_temp.fails_with($q$select * from claim_receipt('509999999', 'N2', 10, now())$q$, 'unknown_shop');
  update merchants set status = 'active' where id = m6;
  update customers set status = 'suspended' where id = cl;
  assert pg_temp.fails_with($q$select * from claim_receipt('509999999', 'N3', 10, now())$q$, 'customer_not_found');
  update customers set status = 'active' where id = cl;

  -- the points are in the ledger and add up
  assert balance_of(ca) = 60 and balance_of(cb) = 20 + 30 + 12 + 80, 'welcome + cashier sale + other shop + typed claim';
  -- tax numbers must be digits only
  assert (select count(*) from pg_constraint where conrelid = 'merchants'::regclass and conname like '%tin%') >= 1;
  raise notice 'receipt tests passed';
end $$;
