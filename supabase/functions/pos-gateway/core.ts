// POS gateway: request handling for POS systems (Fisko POS and others). Pure logic with an injected database call,
// so it can be tested without Deno or Supabase. Every route needs the shop's secret API key.

export type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
export type Req = { method: string; path: string; headers: Record<string, string | undefined>; body: unknown };
export type Res = { status: number; body: Record<string, unknown> };

// ---- how database error codes become HTTP answers a POS can act on
const ERRORS: Record<string, { status: number; message: string }> = {
  invalid_api_key: { status: 401, message: 'The API key is not valid.' },
  shop_inactive: { status: 403, message: 'This shop is not active on Fiji Rewards.' },
  customer_required: { status: 422, message: 'Send the customer QR code or phone number.' },
  customer_not_found: { status: 404, message: 'No active customer found.' },
  qr_invalid: { status: 422, message: 'The customer QR code is not valid.' },
  qr_expired: { status: 422, message: 'The customer QR code is out of date. Ask the customer to show it again.' },
  qr_already_used: { status: 409, message: 'This QR code was already used. Ask the customer for a fresh one.' },
  qr_required: { status: 422, message: 'The customer QR code is incomplete.' },
  receipt_ref_required: { status: 400, message: 'receipt_no is required.' },
  refund_ref_required: { status: 400, message: 'refund_no is required.' },
  receipt_already_claimed: { status: 409, message: 'This receipt has already earned points for someone else.' },
  receipt_not_found: { status: 404, message: 'No sale with this receipt number was found.' },
  already_fully_refunded: { status: 409, message: 'This sale has already been fully refunded.' },
  refund_too_small: { status: 422, message: 'The refund is too small to take back a point.' },
  invalid_amount: { status: 422, message: 'The amount is not valid.' },
  sale_exceeds_max: { status: 422, message: 'The sale is over the FJD 500 limit.' },
  sale_too_small: { status: 422, message: 'The sale is too small to earn a point.' },
  occurred_in_future: { status: 422, message: 'occurred_at is in the future. Check the POS clock.' },
  occurred_too_old: { status: 422, message: 'The sale is older than 7 days and cannot be recorded.' },
  scan_limit_reached: { status: 429, message: 'This customer has already earned several times here this hour.' },
  till_rate_limit: { status: 429, message: 'Too many sales from this POS in the last hour.' },
  daily_limit_customer: { status: 429, message: 'This customer reached the points limit for today.' },
  code_not_found_or_used: { status: 404, message: 'Redemption code not found, or already used.' },
  code_expired: { status: 422, message: 'The redemption code has expired.' },
  insufficient_points: { status: 422, message: 'The customer does not have enough points.' },
};

export function mapError(message: string): Res {
  for (const [code, e] of Object.entries(ERRORS)) if (message.includes(code)) return { status: e.status, body: { ok: false, error: code, message: e.message } };
  return { status: 500, body: { ok: false, error: 'server_error', message: 'Something went wrong. Try again.' } };
}

const fail = (status: number, error: string, message: string): Res => ({ status, body: { ok: false, error, message } });

// ---- reading what the POS sent
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const QR = new RegExp(`^fjr:c:(${UUID}):(\\d{9,11}):([0-9a-f]{20})$`, 'i');

export function parseCustomerQr(text: string): { customerId: string; ts: number; sig: string } | null {
  const m = QR.exec(text.trim());
  return m ? { customerId: m[1].toLowerCase(), ts: Number(m[2]), sig: m[3].toLowerCase() } : null;
}

/** Accepts 7001234, 700 1234, +679 700 1234, 6797001234 and returns +6797001234, or null. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('679')) d = d.slice(3);
  return /^[2-9][0-9]{6}$/.test(d) ? `+679${d}` : null;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

function customerArgs(b: Obj): { args: Obj } | { err: Res } {
  const qr = str(b.customer_qr), phone = str(b.customer_phone);
  if (qr) {
    const p = parseCustomerQr(qr);
    if (!p) return { err: fail(422, 'qr_invalid', 'The customer QR code is not valid.') };
    return { args: { p_customer_id: p.customerId, p_qr_ts: p.ts, p_qr_sig: p.sig } };
  }
  if (phone) {
    const n = normalizePhone(phone);
    if (!n) return { err: fail(422, 'invalid_phone', 'Use a Fiji mobile number such as +6797001234.') };
    return { args: { p_phone: n } };
  }
  return { err: fail(422, 'customer_required', 'Send customer_qr (scanned from the customer) or customer_phone.') };
}

function amountOf(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100000 && /^\d+(\.\d{1,2})?$/.test(String(n)) ? n : null;
}

const refOf = (x: unknown): string | null => {
  const s = str(x);
  return s && s.length <= 64 ? s : null;
};

const firstRow = (d: unknown): Obj | null => (Array.isArray(d) ? (d[0] as Obj) : (d as Obj)) ?? null;

export async function handle(req: Req, rpc: Rpc): Promise<Res> {
  const route = req.path.replace(/\/+$/, '').split('/').pop() ?? '';
  if (!['lookup', 'earn', 'redeem', 'refund'].includes(route)) return fail(404, 'not_found', 'Unknown route. Use /lookup, /earn, /redeem or /refund.');
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.');

  const auth = req.headers['authorization'] ?? req.headers['Authorization'] ?? '';
  const key = (/^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? req.headers['x-api-key'] ?? '').trim();
  if (!key) return fail(401, 'invalid_api_key', 'Send your API key as "Authorization: Bearer <key>".');
  if (!isObj(req.body)) return fail(400, 'bad_request', 'Send a JSON object.');
  const b = req.body;

  const call = async (fn: string, args: Obj): Promise<{ row: Obj } | { err: Res }> => {
    let r: RpcResult;
    try { r = await rpc(fn, { p_key: key, ...args }); } catch { return { err: mapError('') } };
    if (r.error) return { err: mapError(r.error.message) };
    const row = firstRow(r.data);
    return row ? { row } : { err: mapError('') };
  };

  if (route === 'lookup') {
    const c = customerArgs(b); if ('err' in c) return c.err;
    const out = await call('pos_lookup', c.args); if ('err' in out) return out.err;
    return { status: 200, body: { ok: true, first_name: out.row.first_name ?? null, balance: out.row.balance } };
  }

  if (route === 'earn') {
    const amount = amountOf(b.amount); if (amount === null) return fail(422, 'invalid_amount', 'amount must be a positive number with at most 2 decimals.');
    const ref = refOf(b.receipt_no); if (!ref) return fail(400, 'receipt_ref_required', 'receipt_no is required (up to 64 characters).');
    const c = customerArgs(b); if ('err' in c) return c.err;
    const args: Obj = { ...c.args, p_amount_fjd: amount, p_receipt_ref: ref };
    if (b.occurred_at !== undefined) {
      const t = Date.parse(str(b.occurred_at));
      if (Number.isNaN(t)) return fail(422, 'invalid_occurred_at', 'occurred_at must be an ISO date-time such as 2026-10-28T14:05:00+12:00.');
      args.p_occurred_at = new Date(t).toISOString();
    }
    if (str(b.device_id)) args.p_device_id = str(b.device_id).slice(0, 64);
    const out = await call('pos_earn', args); if ('err' in out) return out.err;
    const pts = Number(out.row.points_earned), bal = Number(out.row.new_balance);
    return { status: 200, body: {
      ok: true, duplicate: Boolean(out.row.duplicate), points_earned: pts, balance: bal, first_name: out.row.first_name ?? null,
      receipt_text: `Fiji Rewards: +${pts} points. Balance: ${bal} points.`,
    } };
  }

  if (route === 'redeem') {
    const code = str(b.code), ref = refOf(b.receipt_no);
    if (!/^\d{6}$/.test(code)) return fail(422, 'invalid_code', 'code must be the 6-digit redemption code.');
    if (!ref) return fail(400, 'receipt_ref_required', 'receipt_no is required (up to 64 characters).');
    const out = await call('pos_redeem', { p_code: code, p_receipt_ref: ref, ...(str(b.device_id) ? { p_device_id: str(b.device_id).slice(0, 64) } : {}) });
    if ('err' in out) return out.err;
    return { status: 200, body: {
      ok: true, duplicate: Boolean(out.row.duplicate), reward: out.row.reward_title, discount_fjd: Number(out.row.value_fjd),
      points_spent: Number(out.row.points_spent), balance: Number(out.row.new_balance),
    } };
  }

  // refund
  const ref = refOf(b.receipt_no), rref = refOf(b.refund_no);
  if (!ref) return fail(400, 'receipt_ref_required', 'receipt_no is required (up to 64 characters).');
  if (!rref) return fail(400, 'refund_ref_required', 'refund_no is required: the POS credit-note or void number (up to 64 characters).');
  const args: Obj = { p_receipt_ref: ref, p_refund_ref: rref };
  if (b.amount !== undefined) { const a = amountOf(b.amount); if (a === null) return fail(422, 'invalid_amount', 'amount must be a positive number with at most 2 decimals.'); args.p_refund_amount = a; }
  if (str(b.reason)) args.p_reason = str(b.reason).slice(0, 100);
  const out = await call('pos_refund', args); if ('err' in out) return out.err;
  return { status: 200, body: { ok: true, already_done: Boolean(out.row.already_done), points_reversed: Number(out.row.points_reversed), balance: Number(out.row.new_balance) } };
}
