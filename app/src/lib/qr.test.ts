import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScan, customerQr, redeemQr } from './qr.ts';
import { parseAmount, pointsFor } from './money.ts';
import { friendlyError, isNetworkError } from './errors.ts';

const ID = '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b';

const SIG = 'be3670a6d83c2f531193';

test('qr round trip', () => {
  assert.deepEqual(parseScan(customerQr(ID, 1790000000, SIG)), { kind: 'customer', customerId: ID, ts: 1790000000, sig: SIG });
  assert.deepEqual(parseScan(redeemQr('123456')), { kind: 'redeem', code: '123456' });
});

test('qr rejects other content', () => {
  for (const s of ['', 'hello', 'https://example.com', 'fjr:c:not-a-uuid', 'fjr:c:' + ID, `fjr:c:${ID}:1790000000`, `fjr:c:${ID}:1790000000:short`, `fjr:c:${ID}:abc:${SIG}`, 'fjr:r:12345', 'fjr:r:1234567', 'fjr:x:' + ID]) {
    assert.equal(parseScan(s), null, s);
  }
});

test('amounts', () => {
  assert.equal(parseAmount('12'), 12);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('FJD 7,25'), 7.25);
  assert.equal(parseAmount('500'), 500);
  for (const s of ['', '0', '-5', '500.01', '501', '1.234', 'abc', '12..5']) assert.equal(parseAmount(s), null, s);
});

test('points match the database rule', () => {
  assert.equal(pointsFor(30, 1), 30);
  assert.equal(pointsFor(7, 1.5), 10);
  assert.equal(pointsFor(0.5, 1), 0);
  assert.equal(pointsFor(19.99, 1), 19);
});

test('friendly errors', () => {
  assert.match(friendlyError({ message: 'sale_exceeds_max' }), /500/);
  assert.match(friendlyError({ message: 'ERROR: code_expired' }), /expired/);
  assert.match(friendlyError({ message: 'weird' }), /Something went wrong/);
  assert.match(friendlyError(null, true), /No connection/);
});

test('network errors are told apart from server errors', () => {
  assert.equal(isNetworkError({ message: 'TypeError: Network request failed' }), true);
  assert.equal(isNetworkError({ message: 'AbortError: signal is aborted' }), true);
  assert.equal(isNetworkError({ message: 'sale_exceeds_max' }), false);
});
