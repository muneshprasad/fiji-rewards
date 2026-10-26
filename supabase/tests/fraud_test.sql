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
  m5 uuid := '00000000-0000-4000-8000-000000000005';  -- Palm Coffee Co
  m6 uuid := '00000000-0000-4000-8000-000000000006';
  adm uuid := gen_random_uuid(); s5 uuid := gen_random_uuid(); s6 uuid := gen_random_uuid(); sx uuid := gen_random_uuid();
  ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); cc uuid := gen_random_uuid(); cd uuid := gen_random_uuid(); ce uuid := gen_random_uuid();
  staff5 uuid; staff6 uuid; staffx uuid;
  ts bigint; sig text; r record; n integer; alert_id uuid;
  rw_a uuid; rw_b uuid;
begin
  insert into auth.users (id, phone) values (adm,'6797800001'), (ca,'6797800011'), (cb,'6797800012'), (cc,'6797800013'), (cd,'6797800014'), (ce,'6797800015');
  insert into staff (merchant_id, name, phone, role) values (m5, 'Till Five', '+6797800021', 'cashier') returning id into staff5;
  insert into staff (merchant_id, name, phone, role) values (m6, 'Till Six', '+6797800022', 'cashier') returning id into staff6;
  -- a cashier who is also a customer (same phone), for the self-dealing rule
  insert into staff (merchant_id, name, phone, role) values (m5, 'Sly Cashier', '+6797800015', 'cashier') returning id into staffx;
  insert into auth.users (id, phone) values (s5, '6797800021'), (s6, '6797800022');
  insert into network_admins (user_id) values (adm);

  ------------------------------------------------------------ signed QR codes
  perform pg_temp.as_user(s5);
  ts := pg_temp.epoch(now());
  sig := qr_signature(ca, ts);
  assert length(sig) = 20, 'signature is 20 hex characters';

  select * into r from lookup_customer(ca, null, ts, sig);
  assert r.customer_id = ca, 'lookup with a valid QR works';
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, %s, 'ffffffffffffffffffff')$q$, ca, ts), 'qr_invalid');
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, %s, '%s')$q$, ca, ts + 1, sig), 'qr_invalid'), 'timestamp is part of the signature';
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, null, null)$q$, ca), 'qr_required');
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, %s, '%s')$q$, cb, ts, sig), 'qr_invalid'), 'a code only works for its own customer';
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, %s, '%s')$q$, ca, ts - 400, qr_signature(ca, ts - 400)), 'qr_expired'), 'old QR (a screenshot)';
  assert pg_temp.fails_with(format($q$select * from lookup_customer('%s', null, %s, '%s')$q$, ca, ts + 300, qr_signature(ca, ts + 300)), 'qr_expired'), 'QR from the future';

  -- earn with a QR: accepted once, the same QR cannot be used again
  select * into r from record_earn(ca, 20, gen_random_uuid(), 'till-5', now(), ts, sig);
  assert r.points_earned = 40, 'Palm Coffee rate is 2';
  assert (select entry_method from transactions where id = r.transaction_id) = 'qr';
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 20, gen_random_uuid(), null, now(), %s, '%s')$q$, ca, ts, sig), 'qr_already_used');
  -- but a retry of the very same sale is just a duplicate, not an error
  perform record_earn(ca, 20, '00000000-0000-4000-8000-0000000000d1', 'till-5', now(), pg_temp.epoch(now()) - 1, qr_signature(ca, pg_temp.epoch(now()) - 1));
  select * into r from record_earn(ca, 20, '00000000-0000-4000-8000-0000000000d1', 'till-5', now(), pg_temp.epoch(now()) - 1, qr_signature(ca, pg_temp.epoch(now()) - 1));
  assert r.duplicate, 'retry with the same sale id returns the saved sale';
  -- typed number: allowed, recorded as manual
  select * into r from record_earn(cb, 10, gen_random_uuid());
  assert (select entry_method from transactions where id = r.transaction_id) = 'manual';

  -- a sale saved offline: the QR is checked against when the sale happened, not when it was sent
  ts := pg_temp.epoch(now() - interval '2 hours');
  select * into r from record_earn(cc, 10, gen_random_uuid(), 'till-offline', now() - interval '2 hours', ts, qr_signature(cc, ts));
  assert not r.duplicate, 'offline sale with a QR from that moment is accepted later';
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 10, gen_random_uuid(), null, now() - interval '30 minutes', %s, '%s')$q$, cc, ts, qr_signature(cc, ts)), 'qr_expired'), 'QR from long before the sale is refused';

  -- secrets: a customer reads only their own; staff and admins read none
  perform pg_temp.as_user(ca);
  set local role authenticated;
  assert (select count(*) from customer_secrets) = 1, 'customer sees only their own secret';
  reset role;
  perform pg_temp.as_user(s5);
  set local role authenticated;
  assert (select count(*) from customer_secrets where customer_id <> auth.uid()) = 0, 'staff cannot read other customers secrets';
  reset role;
  perform pg_temp.as_user(adm);
  set local role authenticated;
  assert (select count(*) from customer_secrets where customer_id <> auth.uid()) = 0, 'admins cannot read other customers secrets';
  assert (select count(*) from customers) > 1, 'admins can see customers';
  reset role;
  perform pg_temp.as_user(s5);

  ------------------------------------------------------------ limits (lowered for the test, then restored)
  update network_settings set value = 100 where key = 'max_daily_points_per_customer';
  select * into r from record_earn(cd, 20, gen_random_uuid());                        -- 40 points
  select * into r from record_earn(cd, 20, gen_random_uuid(), null, now() - interval '2 hours');   -- 80 points today
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 20, gen_random_uuid(), null, now() - interval '3 hours')$q$, cd), 'daily_limit_customer');
  update network_settings set value = 1000 where key = 'max_daily_points_per_customer';

  update network_settings set value = 3 where key = 'max_sales_per_till_per_hour';
  -- staff5 already made 4 sales within the hour above, so one more is over the limit
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 5, gen_random_uuid())$q$, ce), 'till_rate_limit');
  update network_settings set value = 40 where key = 'max_sales_per_till_per_hour';

  update network_settings set value = 100 where key = 'max_redemptions_per_customer_per_day';
  perform pg_temp.as_user(ca);
  select id into rw_a from rewards where merchant_id = m5 order by points_cost limit 1;
  select id into rw_b from rewards where merchant_id = m6 order by points_cost limit 1;
  update network_settings set value = 1 where key = 'max_redemptions_per_customer_per_day';
  perform create_redemption(rw_a);
  assert pg_temp.fails_with(format($q$select * from create_redemption('%s')$q$, rw_b), 'redeem_limit_reached');
  update network_settings set value = 3 where key = 'max_redemptions_per_customer_per_day';

  ------------------------------------------------------------ alerts
  perform pg_temp.as_user(adm);
  -- near-cap sales: 3 sales of FJD 480 by one till
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change, entry_method)
    select c, m6, staff6, 'earn', 480, 960, 'qr' from unnest(array[ca, cb, cc]) c;
  -- one customer at 4 shops within the hour
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change)
    select ce, m, null, 'earn', 5, 5 from unnest(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004']::uuid[]) m;
  -- same till and customer six times
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change, created_at)
    select cd, m6, staff6, 'earn', 5, 5, now() - (i || ' minutes')::interval from generate_series(1, 6) i;
  -- the cashier earning for their own phone number
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change)
    values (ce, m5, staffx, 'earn', 12, 24);
  -- a till that never scans QR codes: 10 manual sales
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change, entry_method)
    select ca, m5, staff5, 'earn', 3, 6, 'manual' from generate_series(1, 10);

  n := detect_fraud();
  assert n >= 5, 'at least five alerts, got ' || n;
  assert exists (select 1 from alerts where kind = 'near_cap_sales' and staff_id = staff6), 'near cap';
  assert exists (select 1 from alerts where kind = 'many_shops_hour' and customer_id = ce), 'many shops';
  assert exists (select 1 from alerts where kind = 'repeat_pair' and customer_id = cd), 'repeat pair';
  assert exists (select 1 from alerts where kind = 'self_dealing' and staff_id = staffx), 'self dealing';
  assert exists (select 1 from alerts where kind = 'mostly_manual_entry' and staff_id = staff5), 'mostly manual';
  assert detect_fraud() = 0, 'running detection again adds nothing';

  ------------------------------------------------------------ who can see and act
  perform pg_temp.as_user(s5);
  set local role authenticated;
  assert (select count(*) from alerts) = 0, 'staff cannot read alerts';
  assert pg_temp.fails_with('select detect_fraud()', 'permission denied'), 'detection is not callable by users';
  assert pg_temp.fails_with(format($q$select admin_set_customer_status('%s', 'suspended')$q$, ca), 'not_admin');
  reset role;

  perform pg_temp.as_user(adm);
  set local role authenticated;
  assert (select count(*) from alerts) >= 5, 'admin can read alerts';
  select id into alert_id from alerts where kind = 'self_dealing' limit 1;
  perform admin_handle_alert(alert_id, 'actioned', 'cashier warned');
  assert (select status from alerts where id = alert_id) = 'actioned';
  perform admin_set_customer_status(ce, 'suspended', 'self dealing');
  reset role;
  assert (select status from customers where id = ce) = 'suspended';
  assert exists (select 1 from audit_log where action = 'ADMIN_SET_STATUS' and row_id = ce::text), 'admin action is in the audit log';

  perform pg_temp.as_user(s5);
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 5, gen_random_uuid())$q$, ce), 'customer_not_found'), 'suspended customers cannot earn';

  -- suspending a shop stops its till
  perform pg_temp.as_user(adm);
  perform admin_set_merchant_status(m6, 'suspended', 'test');
  perform pg_temp.as_user(s6);
  assert pg_temp.fails_with(format($q$select * from record_earn('%s', 5, gen_random_uuid())$q$, ca), 'not_staff'), 'suspended shop cannot sell';
  perform pg_temp.as_user(adm);
  perform admin_set_merchant_status(m6, 'active', 'test over');

  raise notice 'fraud tests passed';
end $$;
