-- Pilot numbers. Run in the Supabase SQL editor (as the project owner). All days are Fiji days.

-- 1. Is it being used weekly? Customers who earned or redeemed in the last 7 days, and sign-ups.
select
  (select count(distinct customer_id) from transactions where type in ('earn', 'redeem') and created_at > now() - interval '7 days') as active_customers_7d,
  (select count(*) from customers where created_at > now() - interval '7 days') as new_signups_7d,
  (select count(*) from customers) as total_customers;

-- 2. Which shops are busy? Last 7 days.
select m.business_name,
       count(*) filter (where t.type = 'earn') as sales,
       coalesce(sum(t.amount_fjd) filter (where t.type = 'earn'), 0) as sales_fjd,
       count(distinct t.customer_id) as customers,
       count(*) filter (where t.type = 'redeem') as redemptions
from merchants m
left join transactions t on t.merchant_id = m.id and t.created_at > now() - interval '7 days'
where m.status = 'active'
group by m.business_name order by sales desc;

-- 3. Are people coming back? Customers by number of different days they earned points.
select days_with_sales, count(*) as customers from (
  select customer_id, count(distinct (created_at at time zone 'Pacific/Fiji')::date) as days_with_sales
  from transactions where type = 'earn' group by customer_id
) d group by days_with_sales order by days_with_sales;

-- 4. Is the reward worth it? Points given out versus points spent versus points expired (all time).
select coalesce(sum(points_change) filter (where type = 'earn'), 0) as points_earned,
       coalesce(-sum(points_change) filter (where type = 'redeem'), 0) as points_redeemed,
       coalesce(-sum(points_change) filter (where type = 'expire'), 0) as points_expired,
       round(100.0 * coalesce(-sum(points_change) filter (where type = 'redeem'), 0)
             / nullif(sum(points_change) filter (where type = 'earn'), 0), 1) as redeemed_percent
from transactions;

-- 5. Are the receipts arriving?
select status, count(*) as messages from sms_outbox group by status order by status;

-- 6. Anything suspicious waiting?
select severity, kind, count(*) as open_alerts from alerts where status = 'open' group by severity, kind order by severity, kind;
