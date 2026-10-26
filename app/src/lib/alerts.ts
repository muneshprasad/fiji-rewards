export type AlertRow = {
  id: string; created_at: string; kind: string; severity: 'low' | 'medium' | 'high'; status: 'open' | 'dismissed' | 'actioned';
  details: Record<string, unknown>; merchant_id: string | null; customer_id: string | null;
  merchant: { business_name: string } | null; customer: { phone: string; name: string | null } | null; staff: { name: string } | null;
};

const TITLES: Record<string, string> = {
  near_cap_sales: 'Several sales just under the limit',
  many_shops_hour: 'One customer at many shops within an hour',
  repeat_pair: 'Same cashier and customer again and again',
  self_dealing: 'Cashier earning points for their own number',
  mostly_manual_entry: 'Cashier rarely scans the customer QR',
};

export const alertTitle = (kind: string) => TITLES[kind] ?? kind.replace(/_/g, ' ');

export function alertSummary(a: AlertRow): string {
  const d = a.details as Record<string, number>;
  switch (a.kind) {
    case 'near_cap_sales': return `${d.sales} sales between FJD ${d.min_amount_fjd} and FJD ${d.max_amount_fjd}`;
    case 'many_shops_hour': return `${d.shops} shops, ${d.sales} sales in one hour`;
    case 'repeat_pair': return `${d.sales} sales, ${d.points} points in a day`;
    case 'self_dealing': return `${d.sales} sale${d.sales === 1 ? '' : 's'}, ${d.points} points`;
    case 'mostly_manual_entry': return `${d.manual} of ${d.sales} sales typed in by hand`;
    default: return Object.entries(a.details).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
}

const RANK = { high: 0, medium: 1, low: 2 } as const;
/** High severity first, then newest. */
export const sortAlerts = (rows: AlertRow[]): AlertRow[] =>
  [...rows].sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(b.created_at) - Date.parse(a.created_at));
