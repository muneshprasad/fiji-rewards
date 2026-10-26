import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaleQueue, MAX_QUEUE, daysOld } from './queue.ts';
import type { QueuedSale, Sender, Storage } from './queue.ts';

const memory = (init: Record<string, string> = {}): Storage & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => { data[k] = v; } };
};
const sale = (n: number, over: Partial<QueuedSale> = {}) => ({
  id: `id-${n}`, customerId: `cust-${n}`, customerLabel: `Customer ${n}`, amount: 10 + n,
  occurredAt: new Date(Date.now() - n * 60000).toISOString(), ...over,
});

/** A server that applies each sale id once, however many times it is sent (like the database does). */
function fakeServer() {
  const applied = new Set<string>();
  let calls = 0;
  const reject = new Set<string>();
  return {
    applied, get calls() { return calls; }, reject,
    send(opts: { dropResponseFor?: Set<string>; down?: () => boolean } = {}): Sender {
      return async (s) => {
        calls++;
        if (opts.down?.()) return { ok: false, offline: true, message: 'network' };   // never reached the server
        if (reject.has(s.id)) return { ok: false, offline: false, message: 'sale_exceeds_max' };
        applied.add(s.id);                                                              // processed
        if (opts.dropResponseFor?.delete(s.id)) return { ok: false, offline: true, message: 'network' };   // reply lost
        return { ok: true };
      };
    },
  };
}

test('queue survives an app restart, in order', async () => {
  const store = memory();
  const q = new SaleQueue(store);
  await q.load();
  for (const n of [1, 2, 3]) assert.equal(await q.add(sale(n)), 'added');
  const q2 = new SaleQueue(store);
  await q2.load();
  assert.deepEqual(q2.list().map((s) => s.id), ['id-1', 'id-2', 'id-3']);
  assert.equal(q2.pendingCount(), 3);
});

test('a repeated sale id is not queued twice', async () => {
  const q = new SaleQueue(memory()); await q.load();
  assert.equal(await q.add(sale(1)), 'added');
  assert.equal(await q.add(sale(1)), 'duplicate');
  assert.equal(q.list().length, 1);
});

test('a full queue refuses more sales', async () => {
  const q = new SaleQueue(memory()); await q.load();
  for (let n = 0; n < MAX_QUEUE; n++) await q.add(sale(n));
  assert.equal(await q.add(sale(9999)), 'full');
});

test('everything is sent and the queue empties when online', async () => {
  const q = new SaleQueue(memory()); await q.load();
  for (const n of [1, 2, 3]) await q.add(sale(n));
  const server = fakeServer();
  const r = await q.sync(server.send());
  assert.deepEqual(r, { sent: 3, rejected: 0, stoppedOffline: false });
  assert.equal(q.list().length, 0);
  assert.equal(server.applied.size, 3);
});

test('connection drops mid-sync: sent sales are not resent, the rest wait, and the next sync finishes', async () => {
  const q = new SaleQueue(memory()); await q.load();
  for (const n of [1, 2, 3, 4]) await q.add(sale(n));
  const server = fakeServer();
  let online = true;
  const sender = server.send({ down: () => !online });
  const inner = sender;
  let sent = 0;
  let dropped = false;
  const flaky: Sender = async (s) => { if (sent === 2 && !dropped) { online = false; dropped = true; } const r = await inner(s); if (r.ok) sent++; return r; };

  const first = await q.sync(flaky);
  assert.equal(first.sent, 2); assert.equal(first.stoppedOffline, true);
  assert.deepEqual(q.list().map((s) => s.id), ['id-3', 'id-4']);
  assert.equal(q.list()[0].attempts, 1);

  online = true;
  const second = await q.sync(flaky);
  assert.deepEqual(second, { sent: 2, rejected: 0, stoppedOffline: false });
  assert.equal(q.list().length, 0);
  assert.equal(server.applied.size, 4);
});

test('reply lost after the server saved the sale: the retry cannot create a second sale', async () => {
  const q = new SaleQueue(memory()); await q.load();
  await q.add(sale(1)); await q.add(sale(2));
  const server = fakeServer();
  const send = server.send({ dropResponseFor: new Set(['id-1']) });
  const first = await q.sync(send);
  assert.equal(first.stoppedOffline, true);
  assert.equal(q.list().length, 2);                 // id-1 stays queued because we never saw the confirmation
  const second = await q.sync(send);
  assert.equal(second.sent, 2);
  assert.equal(q.list().length, 0);
  assert.equal(server.applied.size, 2);             // each sale applied exactly once
});

test('a refused sale is marked, kept for the cashier, not retried, and does not block the others', async () => {
  const q = new SaleQueue(memory()); await q.load();
  for (const n of [1, 2, 3]) await q.add(sale(n));
  const server = fakeServer(); server.reject.add('id-2');
  const r = await q.sync(server.send());
  assert.deepEqual(r, { sent: 2, rejected: 1, stoppedOffline: false });
  assert.deepEqual(q.list().map((s) => [s.id, s.status, s.lastError]), [['id-2', 'rejected', 'sale_exceeds_max']]);
  const callsBefore = server.calls;
  await q.sync(server.send());
  assert.equal(server.calls, callsBefore, 'rejected sales are not sent again');
  assert.equal(q.pendingCount(), 0); assert.equal(q.rejectedCount(), 1);
  await q.discard('id-2');
  assert.equal(q.list().length, 0);
});

test('two syncs at once send each sale once', async () => {
  const q = new SaleQueue(memory()); await q.load();
  for (const n of [1, 2, 3]) await q.add(sale(n));
  let calls = 0;
  const slow: Sender = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { ok: true }; };
  const [a, b] = await Promise.all([q.sync(slow), q.sync(slow)]);
  assert.equal(calls, 3);
  assert.strictEqual(a, b);
});

test('a sender that throws counts as offline', async () => {
  const q = new SaleQueue(memory()); await q.load();
  await q.add(sale(1));
  const r = await q.sync(async () => { throw new Error('boom'); });
  assert.equal(r.stoppedOffline, true);
  assert.equal(q.pendingCount(), 1);
});

test('corrupt or foreign data in storage does not break the till', async () => {
  for (const bad of ['{not json', '"hello"', '[1,2,{"id":5}]']) {
    const q = new SaleQueue(memory({ 'fiji.saleQueue.v1': bad })); await q.load();
    assert.equal(q.list().length, 0, bad);
    assert.equal(await q.add(sale(1)), 'added');
  }
});

test('scan limit and age helpers', async () => {
  const q = new SaleQueue(memory()); await q.load();
  const now = Date.now();
  await q.add(sale(1, { id: 'a', customerId: 'c', occurredAt: new Date(now - 10 * 60000).toISOString() }));
  await q.add(sale(2, { id: 'b', customerId: 'c', occurredAt: new Date(now - 50 * 60000).toISOString() }));
  await q.add(sale(3, { id: 'd', customerId: 'c', occurredAt: new Date(now - 2 * 3600000).toISOString() }));
  assert.equal(q.recentFor('c', now), 2);
  assert.equal(q.recentFor('other', now), 0);
  assert.ok(Math.abs(daysOld({ occurredAt: new Date(now - 3 * 86400000).toISOString() } as QueuedSale, now) - 3) < 0.001);
});

test('subscribers hear about changes', async () => {
  const q = new SaleQueue(memory()); await q.load();
  let n = 0; const off = q.subscribe(() => n++);
  await q.add(sale(1)); await q.discard('id-1');
  off(); await q.add(sale(2));
  assert.equal(n, 2);
});
