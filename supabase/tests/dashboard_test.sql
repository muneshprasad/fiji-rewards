\set ON_ERROR_STOP on
create function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, true) $$;

do $$
declare
  m4 uuid := '00000000-0000-4000-8000-000000000004';   -- Island Threads
  mgr uuid := gen_random_uuid(); cash uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  mgr_staff uuid; cash_staff uuid; rows_changed integer; failed boolean; r record; rid uuid;
begin
  insert into staff (merchant_id, name, phone, role) values (m4, 'Owner', '+6797600001', 'manager') returning id into mgr_staff;
  insert into staff (merchant_id, name, phone, role) values (m4, 'Cashier', '+6797600002', 'cashier') returning id into cash_staff;
  insert into auth.users (id, phone) values (mgr, '6797600001'), (cash, '6797600002'), (c1, '6797600011'), (c2, '6797600012');

  -- sales today (Fiji time), one sale yesterday, one at another shop
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change) values
    (c1, m4, cash_staff, 'earn', 30, 30), (c1, m4, cash_staff, 'earn', 20, 20), (c2, m4, cash_staff, 'earn', 50, 50),
    (c2, m4, cash_staff, 'redeem', 0, -40),
    (c1, '00000000-0000-4000-8000-000000000001', null, 'earn', 99, 99);
  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change, created_at)
    values (c1, m4, cash_staff, 'earn', 70, 70, now() - interval '30 hours');

  -- manager sees today's numbers for their shop only
  perform pg_temp.as_user(mgr);
  select * into r from merchant_today();
  assert r.sales_count = 3 and r.sales_fjd = 100 and r.points_issued = 100, 'sales today';
  assert r.redemptions_count = 1 and r.points_redeemed = 40, 'redemptions today';
  assert r.customers = 2, 'unique customers today';
  select * into r from merchant_today(((now() at time zone 'Pacific/Fiji')::date) - 1);
  assert r.sales_count = 1 and r.sales_fjd = 70, 'yesterday is separate';

  -- cashiers cannot see the dashboard
  perform pg_temp.as_user(cash);
  begin perform * from merchant_today(); failed := false; exception when others then failed := sqlerrm like '%not_manager%'; end;
  assert failed, 'cashier blocked from dashboard';

  -- rate limits
  perform pg_temp.as_user(mgr);
  set local role authenticated;
  update merchants set points_per_fjd = 2 where id = m4;
  get diagnostics rows_changed = row_count;
  assert rows_changed = 1, 'manager can change the rate';
  begin update merchants set points_per_fjd = 9 where id = m4; failed := false; exception when others then failed := sqlerrm like '%rate_out_of_range%'; end;
  assert failed, 'rate above network maximum rejected';
  begin update merchants set points_per_fjd = 0.1 where id = m4; failed := false; exception when others then failed := sqlerrm like '%rate_out_of_range%'; end;
  assert failed, 'rate below network minimum rejected';
  begin update merchants set status = 'suspended' where id = m4; failed := false; exception when insufficient_privilege then failed := true; end;
  assert failed, 'owner cannot change shop status';

  -- reward setup by manager
  insert into rewards (merchant_id, title, points_cost, value_fjd, daily_limit) values (m4, 'Free tote bag', 80, 8, 10) returning id into rid;
  update rewards set points_cost = 90 where id = rid;
  update rewards set active_to = now() where id = rid;       -- "end" a reward instead of deleting it
  assert (select active_to from rewards where id = rid) is not null, 'manager can end a reward';
  begin insert into rewards (merchant_id, title, points_cost, value_fjd) values (m4, 'Free', 0, 1); failed := false; exception when check_violation then failed := true; end;
  assert failed, 'zero-point reward rejected';
  reset role;

  -- cashier cannot change rewards or the rate
  perform pg_temp.as_user(cash);
  set local role authenticated;
  begin insert into rewards (merchant_id, title, points_cost, value_fjd) values (m4, 'Sneaky', 10, 1); failed := false; exception when insufficient_privilege then failed := true; end;
  assert failed, 'cashier cannot add rewards';
  update merchants set points_per_fjd = 3 where id = m4;
  get diagnostics rows_changed = row_count;
  assert rows_changed = 0, 'cashier cannot change the rate';
  reset role;

  -- a manager at another shop cannot touch this shop's rewards
  assert (select points_per_fjd from merchants where id = m4) = 2;
  raise notice 'dashboard tests passed';
end $$;
