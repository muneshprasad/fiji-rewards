import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReward, rewardStatus, endTimestamp, parseRate } from './manage.ts';

const ok = { title: 'Free coffee', points: '60', value: '5.50', dailyLimit: '' };

test('a good reward is accepted and cleaned up', () => {
  const r = validateReward({ ...ok, title: '  Free coffee  ', dailyLimit: '25' });
  assert.deepEqual(r, { ok: true, values: { title: 'Free coffee', points_cost: 60, value_fjd: 5.5, daily_limit: 25 } });
  const blank = validateReward(ok);
  assert.ok(blank.ok && blank.values.daily_limit === null);
  assert.ok(validateReward({ ...ok, value: '0' }).ok, 'a free-value reward is allowed');
  assert.ok(validateReward({ ...ok, value: '5,5' }).ok, 'comma decimals are accepted');
});

test('bad rewards say what is wrong', () => {
  const r = validateReward({ title: 'ab', points: '0', value: 'abc', dailyLimit: '0' });
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['dailyLimit', 'points', 'title', 'value']);
  for (const points of ['', '-5', '1.5', '10000000', 'ten']) assert.ok(!validateReward({ ...ok, points }).ok, points);
  assert.ok(!validateReward({ ...ok, value: '5.555' }).ok);
  assert.ok(!validateReward({ ...ok, title: 'x'.repeat(61) }).ok);
  assert.ok(!validateReward({ ...ok, dailyLimit: '2.5' }).ok);
});

test('reward status', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  assert.equal(rewardStatus({ active_from: '2026-01-01T00:00:00Z', active_to: null }, now), 'live');
  assert.equal(rewardStatus({ active_from: '2026-01-01T00:00:00Z', active_to: '2027-01-01T00:00:00Z' }, now), 'live');
  assert.equal(rewardStatus({ active_from: '2026-11-01T00:00:00Z', active_to: null }, now), 'scheduled');
  assert.equal(rewardStatus({ active_from: '2026-01-01T00:00:00Z', active_to: '2026-10-26T00:00:00Z' }, now), 'ended');
});

test('ending a reward never puts the end before the start', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  assert.equal(endTimestamp({ active_from: '2026-01-01T00:00:00Z', active_to: null }, now), '2026-10-26T00:00:00.000Z');
  assert.equal(endTimestamp({ active_from: '2026-12-01T00:00:00Z', active_to: null }, now), '2026-12-01T00:00:00.000Z');
});

test('points rate must sit inside the network limits', () => {
  assert.equal(parseRate('1', 0.5, 5), 1);
  assert.equal(parseRate('1,5', 0.5, 5), 1.5);
  assert.equal(parseRate('0.5', 0.5, 5), 0.5);
  assert.equal(parseRate('5', 0.5, 5), 5);
  for (const s of ['', '0.4', '5.01', '9', '1.234', 'abc', '-1']) assert.equal(parseRate(s, 0.5, 5), null, s);
});
