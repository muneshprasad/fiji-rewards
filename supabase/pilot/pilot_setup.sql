-- Fiji Rewards: Nadi pilot setup (3 merchants). Run once in the Supabase SQL editor, AFTER the migrations.
-- Do NOT run supabase/seed.sql on the live project: that is demo data for local testing.
--
-- BEFORE YOU RUN IT, edit the two blocks marked EDIT. Safe to run again: it updates instead of duplicating.
-- Business names, categories, addresses and rewards below are SAMPLE content: replace them with the real ones.

do $$
declare
  m jsonb;
  s jsonb;
  r jsonb;
  mid uuid;
  -- EDIT: one entry per shop below. owner = manager (sees Today and rewards setup), cashier = till only.
  shops jsonb := $json$[
    {
      "name": "Nadi Fresh Bakery", "category": "Food & drink", "town": "Nadi", "address": "Main Street, Nadi",
      "lat": -17.8050, "lng": 177.4160, "rate": 1,
      "owner":   { "name": "Owner One",   "phone": "+679XXXXXX1" },
      "cashier": { "name": "Cashier One", "phone": "+679XXXXXX2" },
      "rewards": [
        { "title": "Free pastry",         "points": 50,  "value": 3.00,  "daily": 20 },
        { "title": "FJD 10 off a cake",   "points": 150, "value": 10.00, "daily": 5 }
      ]
    },
    {
      "name": "Sunrise Pharmacy", "category": "Health", "town": "Nadi", "address": "Queens Road, Nadi",
      "lat": -17.8030, "lng": 177.4170, "rate": 1,
      "owner":   { "name": "Owner Two",   "phone": "+679XXXXXX3" },
      "cashier": { "name": "Cashier Two", "phone": "+679XXXXXX4" },
      "rewards": [
        { "title": "FJD 5 off any purchase", "points": 100, "value": 5.00, "daily": 10 }
      ]
    },
    {
      "name": "Bula Hardware", "category": "Home & garden", "town": "Nadi", "address": "Sagayam Road, Nadi",
      "lat": -17.8040, "lng": 177.4180, "rate": 1,
      "owner":   { "name": "Owner Three",   "phone": "+679XXXXXX5" },
      "cashier": { "name": "Cashier Three", "phone": "+679XXXXXX6" },
      "rewards": [
        { "title": "FJD 8 off over FJD 50", "points": 120, "value": 8.00, "daily": 8 }
      ]
    }
  ]$json$::jsonb;
begin
  for m in select * from jsonb_array_elements(shops) loop
    -- stop early, with a clear message, if a phone number was not replaced
    foreach s in array array[m->'owner', m->'cashier'] loop
      if (s->>'phone') !~ '^\+679[0-9]{7}$' then
        raise exception 'Replace the placeholder phone number for "%" (%). Use the format +6797001234.', s->>'name', s->>'phone';
      end if;
    end loop;

    select id into mid from merchants where business_name = m->>'name' and town = m->>'town';
    if mid is null then
      insert into merchants (business_name, category, town, address, lat, lng, owner_phone, points_per_fjd, status)
      values (m->>'name', m->>'category', m->>'town', m->>'address', (m->>'lat')::float, (m->>'lng')::float,
              m->'owner'->>'phone', (m->>'rate')::numeric, 'active')
      returning id into mid;
    else
      update merchants set category = m->>'category', address = m->>'address', lat = (m->>'lat')::float, lng = (m->>'lng')::float,
             owner_phone = m->'owner'->>'phone', points_per_fjd = (m->>'rate')::numeric, status = 'active' where id = mid;
    end if;

    insert into staff (merchant_id, name, phone, role) values (mid, m->'owner'->>'name', m->'owner'->>'phone', 'manager')
      on conflict (phone) do update set merchant_id = excluded.merchant_id, name = excluded.name, role = 'manager', active = true;
    insert into staff (merchant_id, name, phone, role) values (mid, m->'cashier'->>'name', m->'cashier'->>'phone', 'cashier')
      on conflict (phone) do update set merchant_id = excluded.merchant_id, name = excluded.name, role = 'cashier', active = true;

    for r in select * from jsonb_array_elements(m->'rewards') loop
      if exists (select 1 from rewards where merchant_id = mid and title = r->>'title') then
        update rewards set points_cost = (r->>'points')::int, value_fjd = (r->>'value')::numeric, daily_limit = (r->>'daily')::int
         where merchant_id = mid and title = r->>'title';
      else
        insert into rewards (merchant_id, title, points_cost, value_fjd, daily_limit)
        values (mid, r->>'title', (r->>'points')::int, (r->>'value')::numeric, (r->>'daily')::int);
      end if;
    end loop;
  end loop;
end $$;

-- Check the result:
select m.business_name, m.points_per_fjd as rate,
       (select count(*) from staff s where s.merchant_id = m.id) as staff,
       (select count(*) from rewards r where r.merchant_id = m.id) as rewards
from merchants m where m.status = 'active' order by m.business_name;
