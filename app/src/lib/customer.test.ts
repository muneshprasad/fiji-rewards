import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, formatDistance } from './geo.ts';
import { activeRewards, buildDeals, categoriesOf, filterByCategory } from './deals.ts';
import type { MerchantRow } from './deals.ts';
import { describeTxn, fijiDate, countdown } from './history.ts';
import { qrMatrix } from './qrMatrix.ts';
import { customerQr } from './qr.ts';
import { signQr } from './qrSign.ts';
import { offsetFromReading, setClockOffset, serverNow } from './clock.ts';

const NOW = new Date('2026-10-26T00:00:00Z');
const rw = (id: string, cost: number, from = '2026-01-01T00:00:00Z', to: string | null = null) =>
  ({ id, title: id, points_cost: cost, value_fjd: 1, active_from: from, active_to: to });
const m = (id: string, cat: string, lat: number | null, lng: number | null, rewards = [rw('r' + id, 50)]): MerchantRow =>
  ({ id, business_name: 'Shop ' + id, category: cat, town: 'Nadi', address: null, lat, lng, points_per_fjd: 1, rewards });

test('distance', () => {
  const d = distanceKm({ lat: -17.805, lng: 177.416 }, { lat: -17.795, lng: 177.44 });
  assert.ok(d > 2.5 && d < 3, String(d));
  assert.equal(distanceKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
  assert.equal(formatDistance(null), '');
  assert.equal(formatDistance(0.4), '400 m');
  assert.equal(formatDistance(2.34), '2.3 km');
  assert.equal(formatDistance(25.6), '26 km');
});

test('active rewards: window and order', () => {
  const list = activeRewards([rw('b', 100), rw('future', 10, '2027-01-01T00:00:00Z'), rw('ended', 10, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'), rw('a', 40)], NOW);
  assert.deepEqual(list.map((r) => r.id), ['a', 'b']);
});

test('deals: hide shops with no live rewards, sort by distance, then by name', () => {
  const here = { lat: -17.805, lng: 177.416 };
  const rows = [m('far', 'Food', -17.7, 177.5), m('near', 'Health', -17.806, 177.417), m('none', 'Food', -17.805, 177.416, [rw('x', 5, '2030-01-01T00:00:00Z')])];
  assert.deepEqual(buildDeals(rows, here, NOW).map((d) => d.id), ['near', 'far']);
  assert.deepEqual(buildDeals(rows, null, NOW).map((d) => d.id), ['far', 'near']);   // A-Z by name without location
  const deals = buildDeals(rows, here, NOW);
  assert.deepEqual(categoriesOf(deals), ['Food', 'Health']);
  assert.deepEqual(filterByCategory(deals, 'Food').map((d) => d.id), ['far']);
  assert.equal(filterByCategory(deals, null).length, 2);
});

test('history wording', () => {
  const base = { id: '1', amount_fjd: 12.5, created_at: '2026-10-26T00:00:00Z', note: null, merchant: { business_name: 'Palm Coffee Co' } } as const;
  assert.deepEqual(describeTxn({ ...base, type: 'earn', points_change: 25 }), { title: 'Palm Coffee Co', detail: 'FJD 12.50 spent', points: '+25', gain: true });
  assert.equal(describeTxn({ ...base, type: 'redeem', points_change: -60, note: 'redeemed: Free flat white' }).detail, 'Free flat white');
  assert.equal(describeTxn({ ...base, type: 'adjust', points_change: 20, note: 'welcome bonus', merchant: null }).title, 'Welcome bonus');
  assert.equal(describeTxn({ ...base, type: 'expire', points_change: -30, merchant: null }).title, 'Points expired');
});

test('Fiji dates and countdown', () => {
  assert.equal(fijiDate('2026-10-26T13:00:00Z'), '27 Oct 2026');   // already the next day in Fiji
  assert.equal(fijiDate('2026-12-31T10:00:00Z'), '31 Dec 2026');
  const now = Date.parse('2026-10-26T00:00:00Z');
  assert.deepEqual(countdown('2026-10-26T00:09:05Z', now), { text: '9:05', expired: false });
  assert.deepEqual(countdown('2026-10-26T00:00:00Z', now), { text: '0:00', expired: true });
});

test('qr matrix is a square grid with finder patterns', () => {
  const g = qrMatrix(customerQr('3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b', 1790000000, 'be3670a6d83c2f531193'));
  assert.ok(g.length >= 25 && g.length <= 45, String(g.length));
  assert.ok(g.every((row) => row.length === g.length));
  assert.ok(g[0][0] && g[0][6] && g[6][0] && g[6][6], 'top-left finder corners are dark');
});

test('QR signature matches the one the database computes', () => {
  // The expected value was produced by Postgres: hmac('<id>:<ts>', decode(repeat('ab',32),'hex'), 'sha256'), first 20 hex characters.
  const secret = 'ab'.repeat(32);
  assert.equal(signQr(secret, '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b', 1790000000), 'be3670a6d83c2f531193');
  assert.notEqual(signQr(secret, '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b', 1790000001), 'be3670a6d83c2f531193');
});

test('clock offset', () => {
  assert.equal(offsetFromReading(10_000, 1_000, 1_200), 10_000 - 1_100);
  setClockOffset(5000);
  assert.ok(Math.abs(serverNow() - (Date.now() + 5000)) < 50);
  setClockOffset(Number.NaN);
  assert.ok(Math.abs(serverNow() - Date.now()) < 50);
});
