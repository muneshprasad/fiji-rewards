\set ON_ERROR_STOP on
create function pg_temp.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, true) $$;

do $$
declare
  m1 uuid := '00000000-0000-4000-8000-000000000001';  -- Nadi Bakehouse
  cu uuid := gen_random_uuid(); cq uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  rw uuid; code text; r record; tx uuid; a bigint; b bigint; ids bigint[]; cnt integer;
begin
  insert into staff (merchant_id, name, phone, role) values (m1, 'Cashier', '+6797900003', 'cashier');
  insert into auth.users (id, phone) values (cu, '6797900001'), (cq, '6797900002'), (st, '6797900003');   -- the staff phone links on sign-in
  -- the welcome bonus is an adjustment, so it sends no receipt
  assert (select count(*) from sms_outbox where customer_id = cu) = 0, 'no receipt for the welcome bonus';

  -- earn
  perform pg_temp.as_user(st);
  select * into r from record_earn(cu, 30, gen_random_uuid());
  select * into r from sms_outbox where customer_id = cu;
  assert r.body = 'Fiji Rewards: +30 points at Nadi Bakehouse (FJD 30.00). Balance: 50 points.', 'earn text: ' || r.body;
  assert r.phone = '+6797900001' and r.status = 'pending';
  assert length(r.body) <= 160, 'fits in one SMS';

  -- redeem
  perform pg_temp.as_user(cu);
  select id into rw from rewards where merchant_id = m1 and points_cost = 50;
  select * into r from create_redemption(rw); code := r.code;
  perform pg_temp.as_user(st);
  perform confirm_redemption(code, gen_random_uuid());
  select body into code from sms_outbox where customer_id = cu order by id desc limit 1;
  assert code = 'Fiji Rewards: Free pastry redeemed at Nadi Bakehouse. -50 points. Balance: 0 points.', 'redeem text: ' || code;

  -- customers can switch receipts off
  update customers set sms_receipts = false where id = cq;
  perform record_earn(cq, 10, gen_random_uuid());
  assert (select count(*) from sms_outbox where customer_id = cq) = 0, 'opted-out customer gets no receipt';

  -- a repeated sale (same id) makes only one receipt
  perform record_earn(cu, 5, '00000000-0000-4000-8000-0000000000e1');
  perform record_earn(cu, 5, '00000000-0000-4000-8000-0000000000e1');
  assert (select count(*) from sms_outbox where customer_id = cu) = 3, 'one receipt per transaction';

  -- sending: claim, mark, retry, give up
  select array_agg(id order by id) into ids from claim_sms_batch(100000) where customer_id = cu;
  assert array_length(ids, 1) = 3, 'three messages claimed';
  assert (select count(*) from claim_sms_batch(100000) where customer_id = cu) = 0, 'claimed messages are not handed out twice';
  assert (select count(*) from sms_outbox where status = 'sending' and customer_id = cu) = 3;

  perform mark_sms(ids[1], true);
  assert (select status from sms_outbox where id = ids[1]) = 'sent' and (select sent_at from sms_outbox where id = ids[1]) is not null;

  perform mark_sms(ids[2], false, 'Twilio 30003: unreachable');
  select * into r from sms_outbox where id = ids[2];
  assert r.status = 'pending' and r.last_error like '%unreachable%' and r.next_attempt_at > now(), 'failure goes back for a later retry';
  assert (select count(*) from claim_sms_batch(100000) where id = ids[2]) = 0, 'not retried before its time';
  update sms_outbox set next_attempt_at = now() where id = ids[2];
  assert (select count(*) from claim_sms_batch(100000) where id = ids[2]) = 1, 'retried when due';
  for i in 1..3 loop
    perform mark_sms(ids[2], false, 'still failing');
    update sms_outbox set next_attempt_at = now() where id = ids[2];
    perform claim_sms_batch(100000);
  end loop;
  perform mark_sms(ids[2], false, 'final');
  assert (select status from sms_outbox where id = ids[2]) = 'failed', 'gives up after four tries';

  -- a worker that crashed: rows stuck in "sending" come back
  update sms_outbox set status = 'sending', next_attempt_at = now() - interval '10 minutes' where id = ids[3];
  assert (select count(*) from claim_sms_batch(100000) where id = ids[3]) = 1, 'stuck messages are picked up again';

  -- nobody but the service role can touch the outbox
  perform pg_temp.as_user(cu);
  set local role authenticated;
  begin perform claim_sms_batch(1); cnt := -1; exception when insufficient_privilege then cnt := 0; end;
  assert cnt = 0, 'users cannot claim messages';
  reset role;
  raise notice 'sms tests passed';
end $$;
