import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, mapError, normalizePhone, parseCustomerQr } from './core.ts';
import type { Req, Rpc } from './core.ts';

const ID = '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b';
const SIG = 'be3670a6d83c2f531193';
const QR = `fjr:c:${ID}:1790000000:${SIG}`;
const KEY = 'fjp_' + 'a'.repeat(48);

function fake(result: { data?: unknown; error?: string } = { data: [{}] }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: Rpc = async (fn, args) => { calls.push({ fn, args }); return { data: result.data ?? null, error: result.error ? { message: result.error } : null }; };
  return { rpc, calls };
}
const post = (path: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${KEY}` }): Req => ({ method: 'POST', path, headers, body });

test('every request needs a key, a known route, POST and a JSON object', async () => {
  const f = fake();
  assert.equal((await handle(post('/pos-gateway/earn', {}, {}), f.rpc)).status, 401);
  assert.equal((await handle({ ...post('/pos-gateway/earn', {}), method: 'GET' }, f.rpc)).status, 405);
  assert.equal((await handle(post('/pos-gateway/nothing', {}), f.rpc)).status, 404);
  assert.equal((await handle(post('/pos-gateway/earn', null), f.rpc)).status, 400);
  assert.equal((await handle(post('/pos-gateway/earn', [1]), f.rpc)).status, 400);
  assert.equal(f.calls.length, 0, 'nothing reaches the database before these checks pass');
});

test('the key can come as a Bearer token or an X-Api-Key header, and is passed on but never echoed', async () => {
  const f = fake({ data: [{ points_earned: 45, new_balance: 65, duplicate: false, first_name: 'Ana' }] });
  const a = await handle(post('/earn', { customer_qr: QR, amount: 45.5, receipt_no: 'INV-1' }), f.rpc);
  const b = await handle(post('/earn', { customer_qr: QR, amount: 45.5, receipt_no: 'INV-1' }, { 'x-api-key': KEY }), f.rpc);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(f.calls[0].args.p_key, KEY);
  assert.ok(!JSON.stringify(a.body).includes(KEY), 'the key is never sent back');
});

test('earn: a scanned QR is split into the id, time and signature; the receipt text is ready to print', async () => {
  const f = fake({ data: [{ points_earned: 45, new_balance: 65, duplicate: false, first_name: 'Ana' }] });
  const r = await handle(post('/earn', { customer_qr: QR, amount: '45.50', receipt_no: ' INV-1001 ', device_id: 'till-2' }), f.rpc);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, duplicate: false, points_earned: 45, balance: 65, first_name: 'Ana', receipt_text: 'Fiji Rewards: +45 points. Balance: 65 points.' });
  assert.deepEqual(f.calls[0], { fn: 'pos_earn', args: {
    p_key: KEY, p_customer_id: ID, p_qr_ts: 1790000000, p_qr_sig: SIG, p_amount_fjd: 45.5, p_receipt_ref: 'INV-1001', p_device_id: 'till-2',
  } });
});

test('earn: a typed phone number is normalised, and occurred_at is passed as an ISO time', async () => {
  const f = fake({ data: [{ points_earned: 12, new_balance: 32, duplicate: false }] });
  await handle(post('/earn', { customer_phone: '700 1234', amount: 12, receipt_no: 'R9', occurred_at: '2026-10-28T14:05:00+12:00' }), f.rpc);
  assert.equal(f.calls[0].args.p_phone, '+6797001234');
  assert.equal(f.calls[0].args.p_occurred_at, '2026-10-28T02:05:00.000Z');
});

test('earn: bad input is refused before the database is called', async () => {
  const f = fake();
  const bad = async (body: Record<string, unknown>) => (await handle(post('/earn', body), f.rpc));
  assert.equal((await bad({ customer_qr: QR, amount: 0, receipt_no: 'R' })).body.error, 'invalid_amount');
  assert.equal((await bad({ customer_qr: QR, amount: 1.234, receipt_no: 'R' })).body.error, 'invalid_amount');
  assert.equal((await bad({ customer_qr: QR, amount: 'abc', receipt_no: 'R' })).body.error, 'invalid_amount');
  assert.equal((await bad({ customer_qr: QR, amount: 5 })).body.error, 'receipt_ref_required');
  assert.equal((await bad({ customer_qr: QR, amount: 5, receipt_no: 'x'.repeat(65) })).body.error, 'receipt_ref_required');
  assert.equal((await bad({ amount: 5, receipt_no: 'R' })).body.error, 'customer_required');
  assert.equal((await bad({ customer_qr: 'hello', amount: 5, receipt_no: 'R' })).body.error, 'qr_invalid');
  assert.equal((await bad({ customer_phone: '123', amount: 5, receipt_no: 'R' })).body.error, 'invalid_phone');
  assert.equal((await bad({ customer_qr: QR, amount: 5, receipt_no: 'R', occurred_at: 'yesterday' })).body.error, 'invalid_occurred_at');
  assert.equal(f.calls.length, 0);
});

test('database errors become the right HTTP status and a plain message', async () => {
  const cases: Array<[string, number, string]> = [
    ['invalid_api_key', 401, 'invalid_api_key'], ['shop_inactive', 403, 'shop_inactive'], ['qr_expired', 422, 'qr_expired'],
    ['qr_already_used', 409, 'qr_already_used'], ['receipt_already_claimed', 409, 'receipt_already_claimed'],
    ['till_rate_limit', 429, 'till_rate_limit'], ['daily_limit_customer', 429, 'daily_limit_customer'],
    ['code_not_found_or_used', 404, 'code_not_found_or_used'], ['already_fully_refunded', 409, 'already_fully_refunded'],
    ['ERROR: something unexpected', 500, 'server_error'],
  ];
  for (const [msg, status, code] of cases) {
    const f = fake({ error: msg });
    const r = await handle(post('/earn', { customer_qr: QR, amount: 5, receipt_no: 'R' }), f.rpc);
    assert.equal(r.status, status, msg); assert.equal(r.body.error, code, msg);
    assert.equal(r.body.ok, false); assert.ok(String(r.body.message).length > 5);
  }
  assert.equal(mapError('').status, 500);
});

test('a database that throws does not crash the gateway or leak details', async () => {
  const rpc: Rpc = async () => { throw new Error('connection refused to db.internal:5432'); };
  const r = await handle(post('/earn', { customer_qr: QR, amount: 5, receipt_no: 'R' }), rpc);
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.body).includes('5432'));
});

test('lookup, redeem and refund send the right things', async () => {
  let f = fake({ data: [{ first_name: 'Ana', balance: 65 }] });
  assert.deepEqual((await handle(post('/lookup', { customer_qr: QR }), f.rpc)).body, { ok: true, first_name: 'Ana', balance: 65 });
  assert.equal(f.calls[0].fn, 'pos_lookup');

  f = fake({ data: [{ reward_title: 'Free tea', value_fjd: '0.50', points_spent: 50, new_balance: 15, duplicate: false }] });
  const red = await handle(post('/redeem', { code: '123456', receipt_no: 'INV-3' }), f.rpc);
  assert.deepEqual(red.body, { ok: true, duplicate: false, reward: 'Free tea', discount_fjd: 0.5, points_spent: 50, balance: 15 });
  assert.equal((await handle(post('/redeem', { code: '12345', receipt_no: 'x' }), f.rpc)).body.error, 'invalid_code');
  assert.equal((await handle(post('/redeem', { code: '123456' }), f.rpc)).body.error, 'receipt_ref_required');

  f = fake({ data: [{ points_reversed: 30, new_balance: 90, already_done: false }] });
  const ref = await handle(post('/refund', { receipt_no: 'INV-4', refund_no: 'CN-1', amount: 30, reason: 'returned goods' }), f.rpc);
  assert.deepEqual(ref.body, { ok: true, already_done: false, points_reversed: 30, balance: 90 });
  assert.deepEqual(f.calls[0].args, { p_key: KEY, p_receipt_ref: 'INV-4', p_refund_ref: 'CN-1', p_refund_amount: 30, p_reason: 'returned goods' });
  assert.equal((await handle(post('/refund', { receipt_no: 'INV-4' }), f.rpc)).body.error, 'refund_ref_required');
});

test('helpers', () => {
  assert.deepEqual(parseCustomerQr(QR), { customerId: ID, ts: 1790000000, sig: SIG });
  assert.equal(parseCustomerQr('fjr:r:123456'), null);
  assert.equal(normalizePhone('+679 700 1234'), '+6797001234');
  assert.equal(normalizePhone('1234'), null);
});
