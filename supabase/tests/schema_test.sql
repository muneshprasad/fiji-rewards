-- Run after the migration and seed on a plain Postgres. Stubs the bits of
-- Supabase this schema needs, then checks the core rules. Fails loudly on error.
\set ON_ERROR_STOP on

do $$
declare
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  s_user uuid := gen_random_uuid();
  m1 uuid := '00000000-0000-4000-8000-000000000001';
  staff1 uuid;
  bal int;
  failed boolean;
begin
  insert into auth.users (id) values (c1), (c2), (s_user);
  insert into customers (id, phone) values (c1, '+6797100001'), (c2, '+6797100002');
  insert into staff (merchant_id, user_id, name, phone, role)
    values (m1, s_user, 'Test Cashier', '+6797200001', 'cashier') returning id into staff1;

  insert into transactions (customer_id, merchant_id, staff_id, type, amount_fjd, points_change)
    values (c1, m1, staff1, 'earn', 30, 30), (c1, m1, staff1, 'earn', 20, 20),
           (c1, m1, staff1, 'redeem', 0, -50), (c2, m1, staff1, 'earn', 10, 10);

  select balance into bal from customer_balances where customer_id = c1;
  assert bal = 0, 'balance should be sum of transactions (got ' || bal || ')';
  select balance into bal from customer_balances where customer_id = c2;
  assert bal = 10, 'balance for c2 should be 10';

  -- append-only
  failed := false;
  begin update transactions set points_change = 999 where customer_id = c1; exception when others then failed := true; end;
  assert failed, 'UPDATE on transactions must be blocked';
  failed := false;
  begin delete from transactions where customer_id = c1; exception when others then failed := true; end;
  assert failed, 'DELETE on transactions must be blocked';
  failed := false;
  begin truncate transactions; exception when others then failed := true; end;
  assert failed, 'TRUNCATE on transactions must be blocked';

  -- sign checks
  failed := false;
  begin insert into transactions (customer_id, merchant_id, type, points_change) values (c1, m1, 'earn', -5);
  exception when check_violation then failed := true; end;
  assert failed, 'earn with negative points must be rejected';

  -- idempotency for the offline queue
  insert into transactions (customer_id, merchant_id, type, points_change, client_txn_id)
    values (c1, m1, 'earn', 5, '11111111-1111-4111-8111-111111111111');
  failed := false;
  begin insert into transactions (customer_id, merchant_id, type, points_change, client_txn_id)
    values (c1, m1, 'earn', 5, '11111111-1111-4111-8111-111111111111');
  exception when unique_violation then failed := true; end;
  assert failed, 'duplicate client_txn_id must be rejected';

  -- redemption code: same 6 digits cannot be open twice at one merchant
  insert into redemption_codes (code, customer_id, merchant_id, reward_id, points_cost, expires_at)
    select '123456', c1, m1, id, points_cost, now() + interval '10 minutes' from rewards where merchant_id = m1 limit 1;
  failed := false;
  begin
    insert into redemption_codes (code, customer_id, merchant_id, reward_id, points_cost, expires_at)
      select '123456', c2, m1, id, points_cost, now() + interval '10 minutes' from rewards where merchant_id = m1 limit 1;
  exception when unique_violation then failed := true; end;
  assert failed, 'open duplicate redemption code must be rejected';

  -- audit trail written
  assert (select count(*) from audit_log where table_name = 'transactions') >= 5, 'transactions must be audited';
  assert (select count(*) from merchants where status = 'active') = 6, 'seed should give 6 active merchants';
  raise notice 'schema tests passed';
end $$;

-- RLS as a customer: sees own rows only, cannot write transactions.
do $$
declare
  c1 uuid := (select id from customers where phone = '+6797100001');
  n int;
  failed boolean := false;
begin
  perform set_config('request.jwt.claim.sub', c1::text, true);
  set local role authenticated;
  select count(*) into n from transactions;
  assert n > 0 and n = (select count(*) from transactions where customer_id = c1), 'customer sees only own transactions';
  select count(*) into n from customers;
  assert n = 1, 'customer sees only self';
  begin
    insert into transactions (customer_id, merchant_id, type, points_change)
      values (c1, '00000000-0000-4000-8000-000000000001', 'earn', 1000);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'customer must not insert transactions';
  reset role;
  raise notice 'rls tests passed';
end $$;
