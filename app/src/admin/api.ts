import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/alerts';

export async function amAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_network_admin');
  return !error && data === true;
}

export async function fetchOpenAlerts(): Promise<AlertRow[] | null> {
  const { data, error } = await supabase.from('alerts')
    .select('id, created_at, kind, severity, status, details, merchant_id, customer_id, merchant:merchants(business_name), customer:customers(phone, name), staff:staff(name)')
    .eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  return error ? null : (data as unknown as AlertRow[]);
}

type Res = { ok: true } | { ok: false; message: string };
const wrap = (error: { message?: string } | null): Res =>
  error ? { ok: false, message: error.message?.includes('not_admin') ? 'Only network admins can do this.' : 'That did not work. Try again.' } : { ok: true };

export const handleAlert = async (id: string, action: 'dismissed' | 'actioned', note?: string): Promise<Res> =>
  wrap((await supabase.rpc('admin_handle_alert', { p_alert: id, p_action: action, p_note: note ?? null })).error);
export const suspendCustomer = async (id: string, note: string): Promise<Res> =>
  wrap((await supabase.rpc('admin_set_customer_status', { p_customer: id, p_status: 'suspended', p_note: note })).error);
export const suspendMerchant = async (id: string, note: string): Promise<Res> =>
  wrap((await supabase.rpc('admin_set_merchant_status', { p_merchant: id, p_status: 'suspended', p_note: note })).error);

import type { NetworkSummary, SettlementRow } from '../lib/settlement';

const num = (x: unknown) => Number(x ?? 0);

export async function fetchSummary(month: string): Promise<NetworkSummary | null> {
  const { data, error } = await supabase.rpc('network_summary', { p_month: month });
  const r = Array.isArray(data) ? data[0] : data;
  if (error || !r) return null;
  const out: Record<string, unknown> = { ...r };
  for (const k of Object.keys(out)) if (k !== 'month') out[k] = num(out[k]);
  return out as unknown as NetworkSummary;
}

export async function calculateStatements(month: string): Promise<Res> {
  return wrap((await supabase.rpc('generate_settlement', { p_month: month })).error);
}

export async function fetchSettlements(month: string): Promise<SettlementRow[] | null> {
  const { data, error } = await supabase.from('settlements')
    .select('id, month, merchant_id, points_issued, points_redeemed, issue_charge, reimbursement, monthly_fee, net_amount, status, issued_at, paid_at, note, merchant:merchants(business_name)')
    .eq('month', month).order('net_amount', { ascending: false });
  if (error) return null;
  return (data as unknown as SettlementRow[]).map((r) => ({
    ...r, issue_charge: num(r.issue_charge), reimbursement: num(r.reimbursement), monthly_fee: num(r.monthly_fee), net_amount: num(r.net_amount),
  }));
}

export const setSettlementStatus = async (id: string, status: 'issued' | 'paid', note?: string): Promise<Res> =>
  wrap((await supabase.rpc('admin_set_settlement_status', { p_id: id, p_status: status, p_note: note ?? null })).error);
