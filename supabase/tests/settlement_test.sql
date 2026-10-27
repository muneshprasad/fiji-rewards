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
  m1 uuid := '00000000-0000-4000-8000-000000000001';   -- issues points
  m3 uuid := '00000000-0000-4000-8000-000000000003';   -- redeems points
  adm uuid := gen_random_uuid(); mgr3 uuid := gen_random_uuid(); mgr1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  r record; sid1 uuid; sid3 uuid; n integer; v_end text;
begin
  insert into staff (merchant_id, name, phone, role) values (m1, 'Mgr One', '+6797950001', 'manager'), (m3, 'Mgr Three', '+6797950003', 'manager');
  insert into auth.users (id, phone) values (adm, '6797950009'), (mgr1, '6797950001'), (mgr3, '6797950003'), (c1, '6797950011');
  insert into network_admins (user_id) values (adm);

  -- July 2026 (Fiji time): shop 1 issues 1000 points, shop 3 issues 500 and redeems 300, and 100 points expire
  insert into transactions (customer_id, merchant_id, type, amount_fjd, points_change, created_at) values
    (c1, m1, 'earn', 1000, 1000, '2026-07-10 10:00+12'),
    (c1, m3, 'earn', 500, 500, '2026-07-20 10:00+12'),
    (c1, m3, 'redeem', 0, -300, '2026-07-25 10:00+12'),
    -- just inside and just outside the month, by Fiji time
    (c1, m1, 'earn', 10, 10, '2026-07-01 00:30+12'),            -- 1 Jul Fiji: inside
    (c1, m1, 'earn', 99, 99, '2026-08-01 00:30+12'),            -- 1 Aug Fiji: outside
    (c1, m1, 'earn', 77, 77, '2026-06-30 23:30+12');            -- 30 Jun Fiji: outside
  insert into transactions (customer_id, type, points_change, note, created_at) values (c1, 'expire', -100, 'points expired', '2026-07-28 12:00+12');

  -- only admins can generate
  perform pg_temp.as_user(mgr1);
  assert pg_temp.fails_with($q$select generate_settlement('2026-07-01')$q$, 'not_admin');

  perform pg_temp.as_user(adm);
  assert pg_temp.fails_with($q$select generate_settlement('2099-01-01')$q$, 'month_not_started'), 'a month that has not started cannot be settled';
  n := generate_settlement('2026-07-15');                  -- any day in the month works
  assert n >= 2, 'statements written';

  select * into r from settlements where merchant_id = m1 and month = '2026-07-01';
  assert r.points_issued = 1010 and r.points_redeemed = 0, 'shop 1 issued 1010 (the 1 Jul 00:30 sale counts, the 1 Aug and 30 Jun ones do not)';
  assert r.issue_charge = 12.12 and r.reimbursement = 0 and r.net_amount = 12.12, 'shop 1 pays 1010 x 0.012 = 12.12';
  assert r.status = 'draft';

  select * into r from settlements where merchant_id = m3 and month = '2026-07-01';
  assert r.points_issued = 500 and r.points_redeemed = 300;
  assert r.issue_charge = 6.00 and r.reimbursement = 3.00 and r.net_amount = 3.00, 'shop 3: pays 6.00, is reimbursed 3.00, net 3.00 to pay';

  -- network view
  select * into r from network_summary('2026-07-01');
  assert r.points_issued = 1510 and r.points_redeemed = 300 and r.points_expired = 100;
  assert r.issue_charges = 18.12 and r.reimbursements = 3.00, 'charges and reimbursements';
  assert r.margin_on_issue = 3.02 and r.breakage_value = 1.00, 'margin 1510 x 0.002 and expired 100 x 0.01';
  assert r.network_earnings = 4.02 + r.monthly_fees, 'earnings = margin + breakage + monthly fees';
  assert r.net_cash = 15.12 + r.monthly_fees, 'cash in minus cash out';
  assert r.outstanding_points > 0 and r.outstanding_liability = round(r.outstanding_points * 0.01, 2), 'liability for points still held';

  -- a second run refreshes drafts but never duplicates
  perform generate_settlement('2026-07-01');
  assert (select count(*) from settlements where merchant_id = m1 and month = '2026-07-01') = 1;

  -- issue and pay: forward only; issued statements are frozen
  select id into sid1 from settlements where merchant_id = m1 and month = '2026-07-01';
  select id into sid3 from settlements where merchant_id = m3 and month = '2026-07-01';
  assert pg_temp.fails_with(format($q$select admin_set_settlement_status('%s', 'paid')$q$, sid1), 'invalid_status_change'), 'cannot pay a draft';
  perform admin_set_settlement_status(sid1, 'issued');
  perform admin_set_settlement_status(sid3, 'issued');
  insert into transactions (customer_id, merchant_id, type, amount_fjd, points_change, created_at) values (c1, m1, 'earn', 500, 500, '2026-07-12 10:00+12');   -- a late entry
  perform generate_settlement('2026-07-01');
  assert (select points_issued from settlements where id = sid1) = 1010, 'an issued statement does not change when the month is generated again';
  perform admin_set_settlement_status(sid1, 'paid', 'bank transfer ref 123');
  assert (select status from settlements where id = sid1) = 'paid' and (select paid_at from settlements where id = sid1) is not null;
  assert pg_temp.fails_with(format($q$select admin_set_settlement_status('%s', 'issued')$q$, sid1), 'invalid_status_change'), 'cannot go backwards';

  -- who sees what
  perform pg_temp.as_user(mgr3);
  set local role authenticated;
  assert (select count(*) from settlements) = 1 and (select merchant_id from settlements) = m3, 'a manager sees only their own shop''s statements';
  reset role;
  perform pg_temp.as_user(mgr1);
  set local role authenticated;
  assert pg_temp.fails_with($q$select network_summary('2026-07-01')$q$, 'not_admin'), 'managers cannot see the network summary';
  reset role;
  -- an unissued draft is hidden from the shop
  perform pg_temp.as_user(adm);
  perform generate_settlement('2026-06-01');
  perform pg_temp.as_user(mgr1);
  set local role authenticated;
  assert not exists (select 1 from settlements where month = '2026-06-01'), 'draft statements are hidden from shops until issued';
  reset role;
  raise notice 'settlement tests passed';
end $$;
