// What the QR codes contain. Short prefixes keep the codes small and easy to scan.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Scan =
  | { kind: 'customer'; customerId: string }
  | { kind: 'redeem'; code: string };

export const customerQr = (customerId: string) => `fjr:c:${customerId}`;
export const redeemQr = (code: string) => `fjr:r:${code}`;

export function parseScan(text: string): Scan | null {
  const t = text.trim();
  const c = /^fjr:c:(.+)$/.exec(t);
  if (c && UUID.test(c[1])) return { kind: 'customer', customerId: c[1].toLowerCase() };
  const r = /^fjr:r:(\d{6})$/.exec(t);
  if (r) return { kind: 'redeem', code: r[1] };
  return null;
}
