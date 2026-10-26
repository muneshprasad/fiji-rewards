-- Sample merchants for the Nadi pilot. Names and numbers are sample content.
insert into merchants (id, business_name, category, town, address, lat, lng, owner_phone, points_per_fjd, status) values
  ('00000000-0000-4000-8000-000000000001', 'Nadi Bakehouse',    'Food & drink', 'Nadi', 'Main St',        -17.8050, 177.4160, '+6797000001', 1,   'active'),
  ('00000000-0000-4000-8000-000000000002', 'Sunrise Pharmacy',   'Health',       'Nadi', 'Queens Rd',      -17.8030, 177.4170, '+6797000002', 1,   'active'),
  ('00000000-0000-4000-8000-000000000003', 'Bula Fresh Market',  'Groceries',    'Nadi', 'Market Rd',      -17.8060, 177.4150, '+6797000003', 1.5, 'active'),
  ('00000000-0000-4000-8000-000000000004', 'Island Threads',     'Clothing',     'Nadi', 'Sagayam Rd',     -17.8040, 177.4180, '+6797000004', 1,   'active'),
  ('00000000-0000-4000-8000-000000000005', 'Palm Coffee Co',     'Food & drink', 'Nadi', 'Namaka Lane',    -17.7950, 177.4400, '+6797000005', 2,   'active'),
  ('00000000-0000-4000-8000-000000000006', 'Quick Fix Mobiles',  'Services',     'Nadi', 'Koroivolu Ave',  -17.8070, 177.4140, '+6797000006', 1,   'active');

insert into rewards (merchant_id, title, points_cost, value_fjd, daily_limit) values
  ('00000000-0000-4000-8000-000000000001', 'Free pastry',            50,  3.00, 20),
  ('00000000-0000-4000-8000-000000000001', 'FJD 10 off a cake',      150, 10.00, 5),
  ('00000000-0000-4000-8000-000000000002', 'FJD 5 off any purchase', 100, 5.00, 10),
  ('00000000-0000-4000-8000-000000000003', 'Free bag of ice',        40,  4.00, 15),
  ('00000000-0000-4000-8000-000000000004', 'FJD 15 off over FJD 60', 200, 15.00, 5),
  ('00000000-0000-4000-8000-000000000005', 'Free flat white',        60,  5.50, 25),
  ('00000000-0000-4000-8000-000000000006', 'Free screen protector',  120, 12.00, 5);
