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
create function pg_temp.epoch(t timestamptz) returns bigint language sql as $$ select floor(extract(epoch from t))::bigint $$;

do $$
declare
  shop uuid := gen_random_uuid();                    -- a fresh shop used only by this test
  other uuid := '00000000-0000-4000-8000-000000000002';
  adm uuid := gen_random_uuid(); ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); cc uuid := gen_random_uuid(); user_only uuid := gen_random_uuid();
  k text; k2 text; kother text; key_id uuid; r record; ts bigint; sig text; tx uuid; bal int; rw uuid; code text; kid2 uuid;
begin
  insert into merchants (id, business_name, category, town, owner_phone, points_per_fjd, status, tin)
    values (shop, 'POS Test Shop', 'Food & drink', 'Nadi', '+6797970001', 1, 'active', '508888888');
  insert into rewards (merchant_id, title, points_cost, value_fjd) values (shop, 'Free tea', 50, 0.50) returning id into rw;
  insert into auth.users (id, phone) values (adm, '6797970009'), (ca, '6797970011'), (cb, '6797970012'), (cc, '6797970013'), (user_only, '6797970014');
  insert into network_admins (user_id) values (adm);

  ---------------------------------------------------------------- keys
  perform pg_temp.as_user(user_only);
  assert pg_temp.fails_with(format($q$select admin_create_pos_key('%s', 'Till 1')$q$, shop), 'not_admin'), 'only admins make keys';
  perform pg_temp.as_user(adm);
  k := admin_create_pos_key(shop, 'Till 1');
  assert k like 'fjp_%' and length(k) = 52, 'key format';
  select id into key_id from merchant_api_keys where merchant_id = shop;
  assert (select key_hash from merchant_api_keys where id = key_id) <> k and (select key_prefix from merchant_api_keys where id = key_id) = left(k, 8), 'only a hash is stored';
  assert not exists (select 1 from merchant_api_keys where key_hash = k), 'the key itself is not stored';
  kother := admin_create_pos_key(other, 'Other shop till');
  -- the owner's SQL-editor version works without an app login, and is closed to app users
  perform pg_temp.as_user(null);
  k2 := create_pos_key(shop, 'Owner-made key');
  assert k2 like 'fjp_%' and (select count(*) from pos_auth(k2)) = 1, 'owner-made key works';
  perform revoke_pos_key((select id from merchant_api_keys where name = 'Owner-made key'));
  assert pg_temp.fails_with(format($q$select * from pos_auth('%s')$q$, k2), 'invalid_api_key');
  perform pg_temp.as_user(user_only);
  set local role authenticated;
  assert pg_temp.fails_with(format($q$select create_pos_key('%s', 'x')$q$, shop), 'permission denied'), 'app users cannot make keys this way';
  reset role;
  perform pg_temp.as_user(adm);
  assert pg_temp.fails_with($q$select * from pos_auth('fjp_wrong')$q$, 'invalid_api_key');
  assert pg_temp.fails_with($q$select * from pos_auth(null)$q$, 'invalid_api_key');

  ---------------------------------------------------------------- earn by QR
  ts := pg_temp.epoch(now()); sig := qr_signature(ca, ts);
  select * into r from pos_lookup(k, ca, null, ts, sig);
  assert r.customer_id = ca and r.balance = 20, 'lookup shows the welcome balance';
  select * into r from pos_earn(k, 45.50, 'inv-1001', ca, ts, sig);
  assert r.points_earned = 45 and r.new_balance = 65 and not r.duplicate, 'FJD 45.50 at rate 1 = 45 points';
  tx := r.transaction_id;
  assert (select channel from transactions where id = tx) = 'pos' and (select pos_key_id from transactions where id = tx) = key_id and (select staff_id from transactions where id = tx) is null;
  assert (select entry_method from transactions where id = tx) = 'qr' and (select receipt_ref from transactions where id = tx) = 'INV-1001';

  -- the POS resends the same sale (its own retry): same result, nothing extra, even though the QR is now used
  select * into r from pos_earn(k, 45.50, ' INV-1001 ', ca, ts, sig);
  assert r.duplicate and r.transaction_id = tx and r.new_balance = 65, 'a resend by receipt number is safe';
  assert (select count(*) from transactions where customer_id = ca and channel = 'pos') = 1;

  -- the same QR on a different receipt is refused; a stale one too
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 10, 'inv-1002', '%s', %s, '%s')$q$, k, ca, ts, sig), 'qr_already_used');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 10, 'inv-1003', '%s', %s, '%s')$q$, k, cb, ts - 600, qr_signature(cb, ts - 600)), 'qr_expired');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 10, 'inv-1004', '%s', %s, 'ffffffffffffffffffff')$q$, k, cb, ts), 'qr_invalid');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 10, 'inv-1005')$q$, k), 'customer_required');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 10, '  ')$q$, k), 'receipt_ref_required');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 501, 'inv-1006', '%s', %s, '%s')$q$, k, cb, ts, qr_signature(cb, ts)), 'sale_exceeds_max');

  -- a different customer cannot reuse a receipt number that is already someone's
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 45.50, 'inv-1001', '%s', %s, '%s')$q$, k, cb, ts + 1, qr_signature(cb, ts + 1)), 'receipt_already_claimed');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 45.50, 'inv-1001', null, null, null, '+6797970012')$q$, k), 'receipt_already_claimed');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 45.50, 'inv-1001')$q$, k), 'customer_required');

  ---------------------------------------------------------------- earn by phone (typed at the POS)
  select * into r from pos_earn(k, 12, 'inv-2001', null, null, null, '+6797970012');
  assert r.points_earned = 12;
  assert (select entry_method from transactions where id = r.transaction_id) = 'manual', 'typed-phone sales are marked manual';
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 12, 'inv-2002', null, null, null, '+6797999999')$q$, k), 'customer_not_found');

  ---------------------------------------------------------------- one shop's key cannot act for another shop
  select * into r from pos_earn(kother, 10, 'inv-1001', ca, pg_temp.epoch(now()) + 1, qr_signature(ca, pg_temp.epoch(now()) + 1));
  assert (select merchant_id from transactions where id = r.transaction_id) = other, 'the sale lands at the key''s own shop';
  assert (select count(*) from transactions where receipt_ref = 'INV-1001') = 2, 'receipt numbers are per shop';

  ---------------------------------------------------------------- the receipt claim and the POS cannot both pay
  perform pg_temp.as_user(ca);
  select * into r from claim_receipt('508888888', 'inv-1001', 45.50, now());
  assert r.duplicate and r.transaction_id = tx, 'the customer scanning that receipt is told it is already counted';

  ---------------------------------------------------------------- redeem at the POS
  perform pg_temp.as_user(ca);
  update network_settings set value = 100 where key = 'max_redemptions_per_customer_per_day';
  bal := balance_of(ca);
  select * into r from create_redemption(rw); code := r.code;
  perform pg_temp.as_user(adm);
  select * into r from pos_redeem(k, code, 'inv-3001');
  assert r.points_spent = 50 and r.value_fjd = 0.50 and r.reward_title = 'Free tea' and not r.duplicate, 'redeemed at the POS';
  assert r.new_balance = bal - 50, 'balance after the redemption';
  assert (select channel from transactions where id = r.transaction_id) = 'pos';
  select * into r from pos_redeem(k, code, 'inv-3001');
  assert r.duplicate, 'resending the same redemption is safe';
  assert pg_temp.fails_with(format($q$select * from pos_redeem('%s', '%s', 'inv-3002')$q$, k, code), 'code_not_found_or_used');
  update network_settings set value = 3 where key = 'max_redemptions_per_customer_per_day';

  ---------------------------------------------------------------- refunds
  -- cc buys FJD 100 (100 points), then returns FJD 30 and later the rest
  ts := pg_temp.epoch(now()); sig := qr_signature(cc, ts);
  select * into r from pos_earn(k, 100, 'inv-4001', cc, ts, sig);
  assert r.points_earned = 100 and r.new_balance = 120;
  select * into r from pos_refund(k, 'INV-4001', 'cn-1', 30, 'returned goods');
  assert r.points_reversed = 30 and r.new_balance = 90 and not r.already_done, 'FJD 30 of FJD 100 takes back 30 points';
  select * into r from pos_refund(k, 'inv-4001', 'CN-1', 30);
  assert r.already_done and r.points_reversed = 30 and r.new_balance = 90, 'a resend of the same credit note changes nothing';
  select * into r from pos_refund(k, 'inv-4001', 'cn-2');
  assert r.points_reversed = 70 and r.new_balance = 20, 'the rest is taken back';
  assert pg_temp.fails_with($q$select * from pos_refund('fjp_not_a_real_key', 'inv-4001', 'cn-3')$q$, 'invalid_api_key');
  assert pg_temp.fails_with(format($q$select * from pos_refund('%s', 'inv-4001', 'cn-3')$q$, k), 'already_fully_refunded');
  assert pg_temp.fails_with(format($q$select * from pos_refund('%s', 'inv-9999', 'cn-4')$q$, k), 'receipt_not_found');
  assert pg_temp.fails_with(format($q$select * from pos_refund('%s', 'inv-4001', '')$q$, k), 'refund_ref_required');
  assert pg_temp.fails_with(format($q$select * from pos_refund('%s', 'inv-1001', 'cn-5', 0.1)$q$, k), 'refund_too_small');
  assert (select count(*) from transactions where refund_of is not null and customer_id = cc) = 2;

  -- the points are gone from the ledger and the balance is the sum of the history
  assert balance_of(cc) = (select coalesce(sum(points_change), 0) from transactions where customer_id = cc);

  -- the shop's monthly statement counts points net of refunds
  perform pg_temp.as_user(adm);
  perform generate_settlement(date_trunc('month', now() at time zone 'Pacific/Fiji')::date);
  select * into r from settlements where merchant_id = shop and month = date_trunc('month', now() at time zone 'Pacific/Fiji')::date;
  -- issued: 45 + 12 + 100 - 100 (refunds) = 57
  assert r.points_issued = 57, 'issued points net of refunds, got ' || r.points_issued;

  ---------------------------------------------------------------- revoking and suspending
  perform admin_revoke_pos_key(key_id);
  assert pg_temp.fails_with(format($q$select * from pos_lookup('%s', '%s', null, 1, 'x')$q$, k, ca), 'invalid_api_key'), 'a revoked key stops working';
  k2 := admin_create_pos_key(shop, 'Till 2');
  select id into kid2 from merchant_api_keys where key_hash = encode(digest(k2, 'sha256'), 'hex');
  update merchants set status = 'suspended' where id = shop;
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 5, 'inv-5001', null, null, null, '+6797970012')$q$, k2), 'shop_inactive');
  update merchants set status = 'active' where id = shop;

  ---------------------------------------------------------------- limits apply to the POS too, per key
  update network_settings set value = 2 where key = 'max_sales_per_till_per_hour';
  perform pos_earn(k2, 5, 'inv-6001', null, null, null, '+6797970013');
  perform pos_earn(k2, 5, 'inv-6002', null, null, null, '+6797970014');
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 5, 'inv-6003', null, null, null, '+6797970011')$q$, k2), 'till_rate_limit');
  update network_settings set value = 40 where key = 'max_sales_per_till_per_hour';

  ---------------------------------------------------------------- app users cannot call any of this
  perform pg_temp.as_user(ca);
  set local role authenticated;
  assert pg_temp.fails_with(format($q$select * from pos_earn('%s', 5, 'inv-7001', null, null, null, '+6797970012')$q$, k2), 'permission denied'), 'not callable by app users';
  assert pg_temp.fails_with($q$select * from earn_core(null, null, null, null, 1, null, null, now(), null, null, null, 'x')$q$, 'permission denied');
  assert pg_temp.fails_with('select count(*) from merchant_api_keys', 'permission denied'), 'app users cannot read the key table';
  reset role;
  raise notice 'pos tests passed';
end $$;
