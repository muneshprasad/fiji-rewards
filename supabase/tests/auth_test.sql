\set ON_ERROR_STOP on
do $$
declare
  u uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  su uuid := gen_random_uuid();
  sid uuid;
begin
  -- staff exists before they ever sign in
  insert into staff (merchant_id, name, phone, role)
    values ('00000000-0000-4000-8000-000000000002', 'Pharmacy Manager', '+6797300001', 'manager') returning id into sid;

  insert into auth.users (id, phone) values (u, '6797300002');
  assert (select phone from customers where id = u) = '+6797300002', 'customer created with + prefix';
  assert (select balance from customer_balances where customer_id = u) = 20, 'welcome bonus of 20 granted';
  assert (select expires_at from transactions where customer_id = u) > now() + interval '11 months', 'bonus expires in ~12 months';

  -- email-less / phone-less users are ignored
  insert into auth.users (id, phone) values (u2, null);
  assert not exists (select 1 from customers where id = u2), 'no customer without a phone';

  -- staff phone gets linked on first sign-in
  insert into auth.users (id, phone) values (su, '6797300001');
  assert (select user_id from staff where id = sid) = su, 'staff linked to auth user';
  assert exists (select 1 from customers where id = su), 'staff member also gets a customer wallet';

  -- balance after the 20-point bonus is only ever appended to
  assert (select count(*) from transactions where customer_id = u) = 1, 'exactly one welcome bonus';
  raise notice 'auth tests passed';
end $$;
