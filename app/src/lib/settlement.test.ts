import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeNet, monthLabel, previousMonth, shiftMonth, suggestedPoints } from './settlement.ts';

test('who pays whom, in plain words', () => {
  assert.deepEqual(describeNet(12.12), { text: 'Pay the network FJD 12.12', tone: 'pay' });
  assert.deepEqual(describeNet(-3), { text: 'The network pays you FJD 3.00', tone: 'receive' });
  assert.deepEqual(describeNet(0), { text: 'Nothing to pay', tone: 'none' });
  assert.equal(describeNet(0.004).tone, 'none');
});

test('month names and shifting across year ends', () => {
  assert.equal(monthLabel('2026-07-01'), 'July 2026');
  assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftMonth('2026-12-01', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-07-01', -7), '2025-12-01');
});

test('previous month uses Fiji time', () => {
  assert.equal(previousMonth(Date.parse('2026-10-27T12:00:00Z')), '2026-09-01');
  // 31 Oct 13:00 UTC is already 1 Nov in Fiji, so "last month" is October
  assert.equal(previousMonth(Date.parse('2026-10-31T13:00:00Z')), '2026-10-01');
  assert.equal(previousMonth(Date.parse('2026-01-15T00:00:00Z')), '2025-12-01');
});

test('points that match a reward value at FJD 0.01 a point', () => {
  assert.equal(suggestedPoints(3, 0.01), 300);
  assert.equal(suggestedPoints(10, 0.01), 1000);
  assert.equal(suggestedPoints(5.5, 0.01), 550);
  assert.equal(suggestedPoints(0.001, 0.01), 1);
  assert.equal(suggestedPoints(5, 0), 0);
});
