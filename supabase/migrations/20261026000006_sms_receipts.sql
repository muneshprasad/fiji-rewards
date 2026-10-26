-- V1 scope item 7: an SMS receipt for each earn and redeem.
-- A trigger writes the message to an outbox; an Edge Function (supabase/functions/send-receipts)
-- sends it through Twilio and marks it sent or retries it. Customers can switch receipts off.

alter table customers add column sms_receipts boolean not null default true;
grant update (sms_receipts) on customers to authenticated;

create table sms_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  customer_id uuid not null references customers (id),
  phone text not null,
  body text not null,
  transaction_id uuid not null unique references transactions (id),   -- one receipt per transaction
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz
);
create index sms_outbox_due_idx on sms_outbox (next_attempt_at) where status = 'pending';
alter table sms_outbox enable row level security;      -- no policies: only the service role touches it

create function queue_sms_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c customers;
  shop text;
  bal integer;
  msg text;
begin
  if new.type not in ('earn', 'redeem') then return new; end if;
  select * into c from customers where id = new.customer_id;
  if not found or not c.sms_receipts or c.status <> 'active' then return new; end if;
  select left(business_name, 30) into shop from merchants where id = new.merchant_id;
  bal := balance_of(new.customer_id);

  if new.type = 'earn' then
    msg := format('Fiji Rewards: +%s points at %s (FJD %s). Balance: %s points.',
                  new.points_change, coalesce(shop, 'a shop'), to_char(new.amount_fjd, 'FM999990.00'), bal);
  else
    msg := format('Fiji Rewards: %s redeemed at %s. -%s points. Balance: %s points.',
                  left(regexp_replace(coalesce(new.note, 'Reward'), '^redeemed:\s*', ''), 30),
                  coalesce(shop, 'a shop'), -new.points_change, bal);
  end if;

  insert into sms_outbox (customer_id, phone, body, transaction_id) values (c.id, c.phone, msg, new.id)
  on conflict (transaction_id) do nothing;
  return new;
end $$;

create trigger transactions_sms_receipt after insert on transactions
  for each row execute function queue_sms_receipt();

-- Takes up to p_limit due messages for sending. Safe to call from several workers at once.
create function claim_sms_batch(p_limit integer default 20)
returns setof sms_outbox
language plpgsql security definer set search_path = public as $$
begin
  -- a worker that died mid-send leaves rows "sending"; put them back after 5 minutes
  update sms_outbox set status = 'pending', next_attempt_at = now()
   where status = 'sending' and next_attempt_at < now() - interval '5 minutes';
  return query
    update sms_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
    where o.id in (
      select id from sms_outbox where status = 'pending' and next_attempt_at <= now()
      order by id limit p_limit for update skip locked)
    returning o.*;
end $$;

-- Records the result: sent, or back to pending with a growing delay, or failed after 4 tries.
create function mark_sms(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  tries integer;
begin
  select attempts into tries from sms_outbox where id = p_id;
  if p_ok then
    update sms_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif tries >= 4 then
    update sms_outbox set status = 'failed', last_error = left(p_error, 300) where id = p_id;
  else
    update sms_outbox set status = 'pending', last_error = left(p_error, 300),
                          next_attempt_at = now() + make_interval(mins => tries * 2) where id = p_id;
  end if;
end $$;

revoke all on function queue_sms_receipt(), claim_sms_batch(integer), mark_sms(bigint, boolean, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_sms_batch(integer), mark_sms(bigint, boolean, text) to service_role;
  end if;
end $$;
