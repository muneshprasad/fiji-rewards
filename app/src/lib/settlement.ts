export type SettlementRow = {
  id: string; month: string; merchant_id: string; points_issued: number; points_redeemed: number;
  issue_charge: number; reimbursement: number; monthly_fee: number; net_amount: number;
  status: 'draft' | 'issued' | 'paid'; issued_at: string | null; paid_at: string | null; note: string | null;
  merchant: { business_name: string } | null;
};

export type NetworkSummary = {
  month: string; points_issued: number; points_redeemed: number; points_expired: number;
  issue_charges: number; reimbursements: number; monthly_fees: number; margin_on_issue: number; breakage_value: number;
  network_earnings: number; cash_in: number; cash_out: number; net_cash: number; outstanding_points: number; outstanding_liability: number;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (n: number) => `FJD ${Math.abs(n).toFixed(2)}`;

/** In plain words: who pays whom. Positive means the shop pays the network. */
export function describeNet(net: number): { text: string; tone: 'pay' | 'receive' | 'none' } {
  const n = Math.round(net * 100) / 100;
  if (n > 0) return { text: `Pay the network ${money(n)}`, tone: 'pay' };
  if (n < 0) return { text: `The network pays you ${money(n)}`, tone: 'receive' };
  return { text: 'Nothing to pay', tone: 'none' };
}

export const STATUS_LABEL = { draft: 'Draft', issued: 'Issued: waiting for payment', paid: 'Paid' } as const;

/** "2026-07-01" -> "July 2026" */
export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The first day of last month, by Fiji time (UTC+12), as "YYYY-MM-01". */
export function previousMonth(nowMs = Date.now()): string {
  const d = new Date(nowMs + 12 * 3600 * 1000);
  return shiftMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`, -1);
}

export function shiftMonth(isoDate: string, delta: number): string {
  const [y, m] = isoDate.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/** Points that match a reward's FJD value at the network's point value. */
export const suggestedPoints = (valueFjd: number, pointValueFjd: number): number =>
  pointValueFjd > 0 ? Math.max(1, Math.round(valueFjd / pointValueFjd)) : 0;
