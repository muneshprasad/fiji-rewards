-- Day-0 check. Paste into the Supabase SQL editor, change the three phone numbers on the first line, and run.
-- Run it again after each step of the day-0 test in docs/DAY0.md. Rows say PASS or NOT YET, with a detail.
with p as (
  select '+6797001234'::text as customer_phone,   -- EDIT: the test customer's phone
         '+6797001235'::text as cashier_phone,    -- EDIT: the test cashier's phone
         '+6797001236'::text as owner_phone       -- EDIT: the test owner's (manager's) phone
),
cust as (select c.* from customers c, p where c.phone = p.customer_phone),
earns as (select t.* from transactions t join cust on cust.id = t.customer_id where t.type = 'earn'),
checks as (
  select 1 as n, 'Customer signed in' as step,
         exists (select 1 from cust) as ok,
         coalesce((select 'created ' || to_char(created_at at time zone 'Pacific/Fiji', 'DD Mon HH24:MI') from cust), 'no customer with this number yet: sign-in code not completed, or number typed differently') as detail
  union all
  select 2, 'Welcome bonus of 20 points',
         exists (select 1 from transactions t join cust on cust.id = t.customer_id where t.type = 'adjust' and t.note = 'welcome bonus' and t.points_change = 20),
         'balance now: ' || coalesce((select balance::text from customer_balances b join cust on cust.id = b.customer_id), '0')
  union all
  select 3, 'Cashier signed in and linked to a shop',
         exists (select 1 from staff s, p where s.phone = p.cashier_phone and s.user_id is not null and s.active),
         coalesce((select case when s.user_id is null then 'staff record exists but nobody has signed in with this number' when not s.active then 'staff record is switched off' else 'linked to ' || m.business_name || ' (' || m.status || ')' end
                   from staff s join merchants m on m.id = s.merchant_id, p where s.phone = p.cashier_phone), 'no staff record for this number: run pilot_setup.sql')
  union all
  select 4, 'Owner is a manager and signed in',
         exists (select 1 from staff s, p where s.phone = p.owner_phone and s.role = 'manager' and s.user_id is not null and s.active),
         coalesce((select s.role::text || case when s.user_id is null then ', not signed in yet' else ', signed in' end from staff s, p where s.phone = p.owner_phone), 'no staff record for this number')
  union all
  select 5, 'A sale was recorded (any way)',
         exists (select 1 from earns),
         (select count(*) || ' sale(s), ' || coalesce(sum(points_change), 0) || ' points' from earns)
  union all
  select 6, 'A sale was recorded by scanning the QR',
         exists (select 1 from earns where entry_method = 'qr'),
         (select count(*) filter (where entry_method = 'qr') || ' by QR, ' || count(*) filter (where entry_method = 'manual') || ' typed' from earns)
  union all
  select 7, 'Receipt SMS queued for the sale',
         exists (select 1 from sms_outbox o join earns e on e.id = o.transaction_id),
         coalesce((select string_agg(o.status || coalesce(' (' || o.last_error || ')', ''), '; ') from sms_outbox o join earns e on e.id = o.transaction_id), 'none queued: is the customer''s receipts switch on?')
  union all
  select 8, 'Receipt SMS actually sent',
         exists (select 1 from sms_outbox o join earns e on e.id = o.transaction_id where o.status = 'sent'),
         coalesce((select 'pending = the send-receipts job is not running or not due yet; failed = see the reason in the row above' where exists (select 1 from sms_outbox o join earns e on e.id = o.transaction_id where o.status <> 'sent')), 'all sent')
  union all
  select 9, 'A reward was redeemed with a code',
         exists (select 1 from redemption_codes rc join cust on cust.id = rc.customer_id where rc.used_at is not null),
         (select count(*) filter (where used_at is not null) || ' used, ' || count(*) filter (where used_at is null and expires_at > now()) || ' open, ' || count(*) filter (where used_at is null and expires_at <= now()) || ' expired' from redemption_codes rc join cust on cust.id = rc.customer_id)
  union all
  select 10, 'A sale made offline arrived later',
         exists (select 1 from earns e join audit_log a on a.table_name = 'transactions' and a.row_id = e.id::text and a.action = 'INSERT'
                 where a.at - e.created_at > interval '30 seconds'),
         coalesce((select count(*) || ' sale(s) recorded 30+ seconds after they happened' from earns e join audit_log a on a.table_name = 'transactions' and a.row_id = e.id::text and a.action = 'INSERT'
                   where a.at - e.created_at > interval '30 seconds'), 'none yet')
  union all
  select 11, 'Balance equals the sum of the history',
         coalesce((select b.balance = (select coalesce(sum(points_change), 0) from transactions t where t.customer_id = cust.id) from customer_balances b join cust on cust.id = b.customer_id), false),
         'balance ' || coalesce((select balance::text from customer_balances b join cust on cust.id = b.customer_id), '0')
  union all
  select 12, 'You are a network admin (Alerts tab)',
         exists (select 1 from network_admins),
         (select count(*) || ' admin(s) set up' from network_admins)
)
select n, step, case when ok then 'PASS' else 'NOT YET' end as result, detail from checks order by n;

-- The customer's history, newest first:
-- select t.created_at at time zone 'Pacific/Fiji' as fiji_time, t.type, t.points_change, t.amount_fjd, t.entry_method, m.business_name, t.note
-- from transactions t join customers c on c.id = t.customer_id left join merchants m on m.id = t.merchant_id
-- where c.phone = '+6797001234' order by t.created_at desc;
