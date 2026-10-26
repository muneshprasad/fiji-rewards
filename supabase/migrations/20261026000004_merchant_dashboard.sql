-- Build step 7: merchant dashboard and rewards setup.

-- The points rate a shop sets must stay inside the network limits. Owners edit it
-- directly (column grant from step 1); this check is what keeps it in range.
create function check_points_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.points_per_fjd < setting_num('min_points_per_fjd')
     or new.points_per_fjd > setting_num('max_points_per_fjd') then
    raise exception 'rate_out_of_range';
  end if;
  return new;
end $$;

create trigger merchants_rate_check before insert or update of points_per_fjd on merchants
  for each row execute function check_points_rate();

-- Daily numbers for the caller's shop, for one day in Fiji time (default: today). Managers only.
create function merchant_today(p_day date default null)
returns table (
  day date, sales_count integer, sales_fjd numeric, points_issued integer,
  redemptions_count integer, points_redeemed integer, customers integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  st staff := current_staff();
  d date := coalesce(p_day, (now() at time zone 'Pacific/Fiji')::date);
  start_ts timestamptz := d::timestamp at time zone 'Pacific/Fiji';
  end_ts timestamptz := (d + 1)::timestamp at time zone 'Pacific/Fiji';
begin
  if st.id is null then raise exception 'not_staff'; end if;
  if st.role <> 'manager' then raise exception 'not_manager'; end if;
  return query
    select d,
      (count(*) filter (where t.type = 'earn'))::integer,
      coalesce(sum(t.amount_fjd) filter (where t.type = 'earn'), 0),
      (coalesce(sum(t.points_change) filter (where t.type = 'earn'), 0))::integer,
      (count(*) filter (where t.type = 'redeem'))::integer,
      (coalesce(-sum(t.points_change) filter (where t.type = 'redeem'), 0))::integer,
      (count(distinct t.customer_id))::integer
    from transactions t
    where t.merchant_id = st.merchant_id and t.created_at >= start_ts and t.created_at < end_ts;
end $$;

revoke all on function merchant_today(date), check_points_rate() from public, anon;
grant execute on function merchant_today(date) to authenticated;

-- Ending a reward sets active_to to now, or to its start time if it has not started yet.
-- A reward whose end equals its start is simply never live, so allow equal times.
alter table rewards drop constraint rewards_check;
alter table rewards add constraint rewards_window_check check (active_to is null or active_to >= active_from);
