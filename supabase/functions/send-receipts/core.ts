// Sends queued SMS receipts. Pure logic with injected dependencies, so it can be tested without Deno or Twilio.

export type OutboxRow = { id: number; phone: string; body: string };
export type SendResult = { ok: true } | { ok: false; error: string };

export interface Deps {
  claim(limit: number): Promise<OutboxRow[]>;
  mark(id: number, ok: boolean, error?: string): Promise<void>;
  send(to: string, body: string): Promise<SendResult>;
}

export type Summary = { claimed: number; sent: number; failed: number };

/** Claims a batch and sends each message, recording the outcome. One bad message never stops the rest. */
export async function processBatch(deps: Deps, limit = 20): Promise<Summary> {
  const rows = await deps.claim(limit);
  const summary: Summary = { claimed: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    let result: SendResult;
    try {
      result = await deps.send(row.phone, row.body);
    } catch (e) {
      result = { ok: false, error: `exception: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (result.ok) { await deps.mark(row.id, true); summary.sent++; }
    else { await deps.mark(row.id, false, result.error); summary.failed++; }
  }
  return summary;
}

export type TwilioEnv = { accountSid: string; authToken: string; messagingServiceSid: string };
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Sends one SMS through Twilio's Messages API using a Messaging Service (so Twilio picks the sender for Fiji). */
export function twilioSender(env: TwilioEnv, fetchFn: FetchLike) {
  return async (to: string, body: string): Promise<SendResult> => {
    const form = new URLSearchParams({ To: to, MessagingServiceSid: env.messagingServiceSid, Body: body });
    const auth = btoa(`${env.accountSid}:${env.authToken}`);
    try {
      const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${env.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (res.ok) return { ok: true };
      const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      return { ok: false, error: `Twilio ${res.status}${j.code ? ` ${j.code}` : ''}: ${j.message ?? 'error'}` };
    } catch (e) {
      return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
    }
  };
}
