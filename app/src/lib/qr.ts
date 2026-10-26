// What the QR codes contain. Short prefixes keep the codes small and easy to scan.
// Customer codes are signed and change every few seconds: "fjr:c:<customer id>:<unix seconds>:<20 hex signature>".
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CUSTOMER = new RegExp(`^fjr:c:(${UUID}):(\\d{9,11}):([0-9a-f]{20})$`, 'i');

export type Scan =
  | { kind: 'customer'; customerId: string; ts: number; sig: string }
  | { kind: 'redeem'; code: string };

export const customerQr = (customerId: string, ts: number, sig: string) => `fjr:c:${customerId}:${ts}:${sig}`;
export const redeemQr = (code: string) => `fjr:r:${code}`;

export function parseScan(text: string): Scan | null {
  const t = text.trim();
  const c = CUSTOMER.exec(t);
  if (c) return { kind: 'customer', customerId: c[1].toLowerCase(), ts: Number(c[2]), sig: c[3].toLowerCase() };
  const r = /^fjr:r:(\d{6})$/.exec(t);
  if (r) return { kind: 'redeem', code: r[1] };
  return null;
}
