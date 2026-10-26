export type Txn = {
  id: string; type: 'earn' | 'redeem' | 'expire' | 'adjust'; points_change: number; amount_fjd: number;
  created_at: string; note: string | null; merchant: { business_name: string } | { business_name: string }[] | null;
};

const shopName = (t: Txn) => (Array.isArray(t.merchant) ? t.merchant[0]?.business_name : t.merchant?.business_name) ?? null;

export function describeTxn(t: Txn): { title: string; detail: string; points: string; gain: boolean } {
  const shop = shopName(t);
  const points = `${t.points_change > 0 ? '+' : ''}${t.points_change}`;
  const gain = t.points_change > 0;
  switch (t.type) {
    case 'earn': return { title: shop ?? 'Earned points', detail: `FJD ${Number(t.amount_fjd).toFixed(2)} spent`, points, gain };
    case 'redeem': return { title: shop ?? 'Reward', detail: (t.note ?? 'Reward').replace(/^redeemed:\s*/i, ''), points, gain };
    case 'expire': return { title: 'Points expired', detail: 'Points expire 12 months after earning', points, gain };
    default: return { title: t.note === 'welcome bonus' ? 'Welcome bonus' : 'Adjustment', detail: t.note ?? '', points, gain };
  }
}

/** Date in Fiji time, e.g. "26 Oct 2026". */
export function fijiDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 12 * 3600 * 1000);   // Fiji is UTC+12 (no daylight saving in recent years)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function countdown(expiresAt: string, now = Date.now()): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return { text: '0:00', expired: true };
  const s = Math.ceil(ms / 1000);
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, expired: false };
}
