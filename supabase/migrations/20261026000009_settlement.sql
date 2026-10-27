-- Money side of the network (monthly settlement).
--   * A point is worth point_value_fjd (FJD 0.01).
--   * A shop that ISSUES points pays the network issue_fee_fjd_per_point for each one (FJD 0.012, a small margin over the point value).
--   * A shop whose reward is REDEEMED is reimbursed point_value_fjd for each point spent.
--   * Optionally each active shop pays a monthly fee.
--   * The network keeps the margin, the monthly fees, and the value of points that expire unspent.
-- Statements are made per Fiji calendar month. net_amount > 0 means the shop pays the network; < 0 means the network pays the shop.

insert into network_settings (key, value, description) values
  ('point_value_fjd',         0.01,  'What one point is worth in FJD (used to reimburse shops for redemptions)'),
  ('issue_fee_fjd_per_point', 0.012, 'What a shop pays the network for each point it issues'),
  ('monthly_shop_fee_fjd',    0,     'Optional flat monthly fee per active shop');

create table settlements (
  id uuid primary key default gen_random_uuid(),
  month date not null,                              -- first day of the Fiji month
  merchant_id uuid not null references merchants (id),
  points_issued integer not null,
  points_redeemed integer not null,
  point_value numeric(8,4) not null,                -- the rates used, kept with the statement
  issue_fee_per_point numeric(8,4) not null,
  issue_charge numeric(12,2) not null,
  reimbursement numeric(12,2) not null,
  monthly_fee numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid')),
  note text,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  paid_at timestamptz,
  unique (merchant_id, month)
);
alter table settlements enable row level security;
-- a shop's manager sees their own statements once they are issued; admins see everything
create policy settlements_manager_read on settlements for select to authenticated
  using (merchant_id = current_staff_merchant() and current_staff_is_manager() and status <> 'draft');
create policy settlements_admin_read on settlements for select to authenticated using (is_network_admin());
create trigger audit_settlements after insert or update on settlements for each row execute function audit_row_change();
grant select on settlements to authenticated;

-- Works out (or refreshes) the draft statements for a month. Issued and paid statements are never changed.
create function generate_settlement(p_month date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  start_ts timestamptz := m::timestamp at time zone 'Pacific/Fiji';
  end_ts timestamptz := (m + interval '1 month')::timestamp at time zone 'Pacific/Fiji';
  pv numeric := setting_num('point_value_fjd');
  fee numeric := setting_num('issue_fee_fjd_per_point');
  mfee numeric := setting_num('monthly_shop_fee_fjd');
  n integer;
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  if m >= (now() at time zone 'Pacific/Fiji')::date - ((extract(day from now() at time zone 'Pacific/Fiji'))::int - 1) + interval '1 month' then
    raise exception 'month_not_started';
  end if;

  insert into settlements (month, merchant_id, points_issued, points_redeemed, point_value, issue_fee_per_point,
                           issue_charge, reimbursement, monthly_fee, net_amount)
  select m, mer.id, coalesce(t.issued, 0), coalesce(t.redeemed, 0), pv, fee,
         round(coalesce(t.issued, 0) * fee, 2),
         round(coalesce(t.redeemed, 0) * pv, 2),
         case when mer.status = 'active' then mfee else 0 end,
         round(coalesce(t.issued, 0) * fee, 2) + (case when mer.status = 'active' then mfee else 0 end) - round(coalesce(t.redeemed, 0) * pv, 2)
  from merchants mer
  left join (
    select merchant_id,
           coalesce(sum(points_change) filter (where type = 'earn'), 0)::integer as issued,
           coalesce(-sum(points_change) filter (where type = 'redeem'), 0)::integer as redeemed
    from transactions where created_at >= start_ts and created_at < end_ts and merchant_id is not null
    group by merchant_id) t on t.merchant_id = mer.id
  where mer.status = 'active' or t.merchant_id is not null
  on conflict (merchant_id, month) do update set
    points_issued = excluded.points_issued, points_redeemed = excluded.points_redeemed,
    point_value = excluded.point_value, issue_fee_per_point = excluded.issue_fee_per_point,
    issue_charge = excluded.issue_charge, reimbursement = excluded.reimbursement,
    monthly_fee = excluded.monthly_fee, net_amount = excluded.net_amount
  where settlements.status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

-- draft -> issued -> paid, never backwards
create function admin_set_settlement_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur text;
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  select status into cur from settlements where id = p_id;
  if not found then raise exception 'settlement_not_found'; end if;
  if not ((cur = 'draft' and p_status = 'issued') or (cur = 'issued' and p_status = 'paid')) then
    raise exception 'invalid_status_change';
  end if;
  update settlements set status = p_status, note = coalesce(p_note, note),
         issued_at = case when p_status = 'issued' then now() else issued_at end,
         paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_id;
end $$;

-- What the month means for the network itself (admin only), at the current rates.
create function network_summary(p_month date)
returns table (
  month date, points_issued bigint, points_redeemed bigint, points_expired bigint,
  issue_charges numeric, reimbursements numeric, monthly_fees numeric,
  margin_on_issue numeric, breakage_value numeric, network_earnings numeric,
  cash_in numeric, cash_out numeric, net_cash numeric, outstanding_points bigint, outstanding_liability numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  start_ts timestamptz := m::timestamp at time zone 'Pacific/Fiji';
  end_ts timestamptz := (m + interval '1 month')::timestamp at time zone 'Pacific/Fiji';
  pv numeric := setting_num('point_value_fjd');
  fee numeric := setting_num('issue_fee_fjd_per_point');
  mfee numeric := setting_num('monthly_shop_fee_fjd');
  iss bigint; red bigint; exp bigint; fees numeric; outst bigint;
begin
  if not is_network_admin() then raise exception 'not_admin'; end if;
  select coalesce(sum(points_change) filter (where type = 'earn'), 0),
         coalesce(-sum(points_change) filter (where type = 'redeem'), 0),
         coalesce(-sum(points_change) filter (where type = 'expire'), 0)
    into iss, red, exp
    from transactions where created_at >= start_ts and created_at < end_ts;
  select count(*) * mfee into fees from merchants where status = 'active';
  select coalesce(sum(points_change), 0) into outst from transactions where created_at < end_ts;
  return query select m, iss, red, exp,
    round(iss * fee, 2), round(red * pv, 2), fees,
    round(iss * (fee - pv), 2), round(exp * pv, 2),
    round(iss * (fee - pv), 2) + fees + round(exp * pv, 2),
    round(iss * fee, 2) + fees, round(red * pv, 2),
    round(iss * fee, 2) + fees - round(red * pv, 2),
    outst, round(outst * pv, 2);
end $$;

revoke all on function generate_settlement(date), admin_set_settlement_status(uuid, text, text), network_summary(date) from public, anon;
grant execute on function generate_settlement(date), admin_set_settlement_status(uuid, text, text), network_summary(date) to authenticated;
