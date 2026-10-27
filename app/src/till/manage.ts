import { supabase } from '../lib/supabase';
import { friendlyError, isNetworkError } from '../lib/errors';
import { endTimestamp, RewardValues } from '../lib/manage';
import type { SettlementRow } from '../lib/settlement';

export type Today = {
  day: string; sales_count: number; sales_fjd: number; points_issued: number;
  redemptions_count: number; points_redeemed: number; customers: number;
};
export type ManagedReward = {
  id: string; title: string; points_cost: number; value_fjd: number; active_from: string; active_to: string | null; daily_limit: number | null;
};
type Res<T> = { ok: true; data: T } | { ok: false; message: string };

const fail = (e: { message?: string }): { ok: false; message: string } => {
  const m = e.message ?? '';
  if (m.includes('not_manager')) return { ok: false, message: 'Only the shop manager can do this.' };
  if (m.includes('rate_out_of_range')) return { ok: false, message: 'That points rate is outside the network limits.' };
  return { ok: false, message: friendlyError(e, isNetworkError(e)) };
};

export async function fetchToday(): Promise<Res<Today>> {
  const { data, error } = await supabase.rpc('merchant_today');
  if (error) return fail(error);
  const r = Array.isArray(data) ? data[0] : data;
  return { ok: true, data: { ...r, sales_fjd: Number(r.sales_fjd) } };
}

export async function fetchNetworkLimits(): Promise<{ min: number; max: number; pointValue: number }> {
  const { data } = await supabase.from('network_settings').select('key, value').in('key', ['min_points_per_fjd', 'max_points_per_fjd', 'point_value_fjd']);
  const get = (k: string, d: number) => Number(data?.find((x) => x.key === k)?.value ?? d);
  return { min: get('min_points_per_fjd', 0.5), max: get('max_points_per_fjd', 5), pointValue: get('point_value_fjd', 0.01) };
}

export async function fetchMyStatements(): Promise<SettlementRow[] | null> {
  const { data, error } = await supabase.from('settlements')
    .select('id, month, merchant_id, points_issued, points_redeemed, issue_charge, reimbursement, monthly_fee, net_amount, status, issued_at, paid_at, note')
    .order('month', { ascending: false }).limit(12);
  if (error) return null;
  return (data as unknown as SettlementRow[]).map((r) => ({
    ...r, merchant: null, issue_charge: Number(r.issue_charge), reimbursement: Number(r.reimbursement),
    monthly_fee: Number(r.monthly_fee), net_amount: Number(r.net_amount),
  }));
}

export async function fetchRewards(merchantId: string): Promise<Res<ManagedReward[]>> {
  const { data, error } = await supabase.from('rewards')
    .select('id, title, points_cost, value_fjd, active_from, active_to, daily_limit')
    .eq('merchant_id', merchantId).order('points_cost', { ascending: true });
  return error ? fail(error) : { ok: true, data: (data ?? []).map((r) => ({ ...r, value_fjd: Number(r.value_fjd) })) };
}

export async function saveReward(merchantId: string, id: string | null, v: RewardValues): Promise<Res<null>> {
  const { error } = id
    ? await supabase.from('rewards').update(v).eq('id', id)
    : await supabase.from('rewards').insert({ merchant_id: merchantId, ...v });
  return error ? fail(error) : { ok: true, data: null };
}

/** Rewards are ended, not deleted, so past redemptions keep their history. */
export async function endReward(r: ManagedReward): Promise<Res<null>> {
  const { error } = await supabase.from('rewards').update({ active_to: endTimestamp(r) }).eq('id', r.id);
  return error ? fail(error) : { ok: true, data: null };
}

export async function saveRate(merchantId: string, rate: number): Promise<Res<null>> {
  const { error } = await supabase.from('merchants').update({ points_per_fjd: rate }).eq('id', merchantId);
  return error ? fail(error) : { ok: true, data: null };
}
