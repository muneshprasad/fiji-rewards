import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processBatch, twilioSender } from './core.ts';
import type { Deps, OutboxRow, SendResult } from './core.ts';

const rows = (n: number): OutboxRow[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, phone: `+679700000${i}`, body: `msg ${i + 1}` }));

function deps(queue: OutboxRow[], send: (to: string, body: string) => Promise<SendResult>) {
  const marks: Array<[number, boolean, string | undefined]> = [];
  const d: Deps = {
    claim: async (n) => queue.splice(0, n),
    mark: async (id, ok, err) => { marks.push([id, ok, err]); },
    send,
  };
  return { d, marks };
}

test('sends each message and records the result', async () => {
  const sent: string[] = [];
  const { d, marks } = deps(rows(3), async (to, body) => { sent.push(`${to}|${body}`); return { ok: true }; });
  assert.deepEqual(await processBatch(d), { claimed: 3, sent: 3, failed: 0 });
  assert.equal(sent[0], '+6797000000|msg 1');
  assert.deepEqual(marks.map((m) => [m[0], m[1]]), [[1, true], [2, true], [3, true]]);
});

test('one failure does not stop the others, and the reason is recorded', async () => {
  const { d, marks } = deps(rows(3), async (_to, body) => (body === 'msg 2' ? { ok: false, error: 'Twilio 400 21211: bad number' } : { ok: true }));
  assert.deepEqual(await processBatch(d), { claimed: 3, sent: 2, failed: 1 });
  assert.deepEqual(marks[1], [2, false, 'Twilio 400 21211: bad number']);
  assert.equal(marks[2][1], true);
});

test('a sender that throws is treated as a failed send', async () => {
  const { d, marks } = deps(rows(1), async () => { throw new Error('boom'); });
  assert.deepEqual(await processBatch(d), { claimed: 1, sent: 0, failed: 1 });
  assert.match(marks[0][2] ?? '', /boom/);
});

test('empty queue does nothing', async () => {
  const { d } = deps([], async () => ({ ok: true }));
  assert.deepEqual(await processBatch(d), { claimed: 0, sent: 0, failed: 0 });
});

test('respects the batch limit', async () => {
  const { d } = deps(rows(5), async () => ({ ok: true }));
  assert.equal((await processBatch(d, 2)).claimed, 2);
});

const env = { accountSid: 'AC123', authToken: 'secret', messagingServiceSid: 'MG456' };

test('twilio request is built correctly', async () => {
  let seen: { url: string; init: { method: string; headers: Record<string, string>; body: string } } | null = null;
  const send = twilioSender(env, async (url, init) => { seen = { url, init }; return { ok: true, status: 201, json: async () => ({}) }; });
  assert.deepEqual(await send('+6797001234', 'Hello & welcome'), { ok: true });
  assert.ok(seen);
  const s = seen as { url: string; init: { method: string; headers: Record<string, string>; body: string } };
  assert.equal(s.url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.headers.Authorization, 'Basic ' + Buffer.from('AC123:secret').toString('base64'));
  const body = new URLSearchParams(s.init.body);
  assert.equal(body.get('To'), '+6797001234');
  assert.equal(body.get('MessagingServiceSid'), 'MG456');
  assert.equal(body.get('Body'), 'Hello & welcome');
});

test('twilio errors become readable failures', async () => {
  const bad = twilioSender(env, async () => ({ ok: false, status: 400, json: async () => ({ code: 21608, message: 'Unverified number' }) }));
  assert.deepEqual(await bad('+6797001234', 'x'), { ok: false, error: 'Twilio 400 21608: Unverified number' });
  const unreadable = twilioSender(env, async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }));
  assert.deepEqual(await unreadable('+6797001234', 'x'), { ok: false, error: 'Twilio 502: error' });
  const down = twilioSender(env, async () => { throw new Error('connection reset'); });
  assert.deepEqual(await down('+6797001234', 'x'), { ok: false, error: 'network: connection reset' });
});
