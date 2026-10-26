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
