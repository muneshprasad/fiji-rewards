\set ON_ERROR_STOP on
-- Run after pilot_setup.sql (with placeholders replaced), twice, to prove it is safe to repeat.
do $$
begin
  assert (select count(*) from merchants where business_name in ('Nadi Fresh Bakery', 'Sunrise Pharmacy', 'Bula Hardware') and status = 'active') = 3, 'three pilot shops';
  assert (select count(*) from staff where phone like '+679700000%') = 6, 'six staff, none duplicated';
  assert (select count(*) from staff where phone like '+679700000%' and role = 'manager') = 3, 'three managers';
  assert (select count(*) from rewards r join merchants m on m.id = r.merchant_id where m.business_name in ('Nadi Fresh Bakery', 'Sunrise Pharmacy', 'Bula Hardware')) = 4, 'four rewards, none duplicated';
  raise notice 'pilot setup check passed';
end $$;
