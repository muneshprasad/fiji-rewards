import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertSummary, alertTitle, sortAlerts } from './alerts.ts';
import type { AlertRow } from './alerts.ts';

const row = (over: Partial<AlertRow>): AlertRow => ({
  id: 'x', created_at: '2026-10-26T00:00:00Z', kind: 'near_cap_sales', severity: 'medium', status: 'open', details: {},
  merchant_id: null, customer_id: null, merchant: null, customer: null, staff: null, ...over,
});

test('alerts read in plain words', () => {
  assert.equal(alertTitle('self_dealing'), 'Cashier earning points for their own number');
  assert.equal(alertTitle('something_new'), 'something new');
  assert.equal(alertSummary(row({ details: { sales: 3, min_amount_fjd: 470, max_amount_fjd: 500 } })), '3 sales between FJD 470 and FJD 500');
  assert.equal(alertSummary(row({ kind: 'mostly_manual_entry', details: { sales: 12, manual: 11 } })), '11 of 12 sales typed in by hand');
  assert.equal(alertSummary(row({ kind: 'unknown_kind', details: { a: 1 } })), 'a: 1');
});

test('worst first, then newest', () => {
  const a = row({ id: 'low-new', severity: 'low', created_at: '2026-10-27T00:00:00Z' });
  const b = row({ id: 'high-old', severity: 'high', created_at: '2026-10-20T00:00:00Z' });
  const c = row({ id: 'high-new', severity: 'high', created_at: '2026-10-25T00:00:00Z' });
  assert.deepEqual(sortAlerts([a, b, c]).map((x) => x.id), ['high-new', 'high-old', 'low-new']);
});
