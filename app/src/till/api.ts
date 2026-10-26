import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { friendlyError, isNetworkError } from '../lib/errors';

export const newTxnId = () => Crypto.randomUUID();

export type StaffInfo = {
  id: string; name: string; role: 'cashier' | 'manager';
  merchant: { id: string; business_name: string; points_per_fjd: number };
};
export type CustomerInfo = { customer_id: string; name: string | null; phone: string; balance: number };
export type EarnResult = { transaction_id: string; points_earned: number; new_balance: number; duplicate: boolean };
export type RedeemResult = {
  transaction_id: string; reward_title: string; value_fjd: number; points_spent: number; new_balance: number; duplicate: boolean;
};
export type Outcome<T> = { ok: true; data: T } | { ok: false; message: string; offline: boolean };

function fail(err: { message?: string } | null): { ok: false; message: string; offline: boolean } {
  const offline = isNetworkError(err);
  return { ok: false, message: friendlyError(err, offline), offline };
}

/** Returns the signed-in user's staff record, or null if they are not staff. */
export async function fetchStaff(userId: string): Promise<StaffInfo | null> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, active, merchant:merchants(id, business_name, points_per_fjd)')
    .eq('user_id', userId).eq('active', true).maybeSingle();
  if (error || !data || !data.merchant) return null;
  const m = Array.isArray(data.merchant) ? data.merchant[0] : data.merchant;
  return { id: data.id, name: data.name, role: data.role, merchant: { ...m, points_per_fjd: Number(m.points_per_fjd) } };
}

export async function lookupCustomer(by: { customerId?: string; phone?: string }): Promise<Outcome<CustomerInfo>> {
  const { data, error } = await supabase.rpc('lookup_customer', {
    p_customer_id: by.customerId ?? null, p_phone: by.phone ?? null,
  });
  if (error) return fail(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { ok: true, data: row as CustomerInfo } : fail({ message: 'customer_not_found' });
}

export async function earn(customerId: string, amount: number, txnId: string, deviceId: string | null): Promise<Outcome<EarnResult>> {
  const { data, error } = await supabase.rpc('record_earn', {
    p_customer_id: customerId, p_amount_fjd: amount, p_client_txn_id: txnId, p_device_id: deviceId,
  });
  if (error) return fail(error);
  return { ok: true, data: (Array.isArray(data) ? data[0] : data) as EarnResult };
}

export async function redeem(code: string, txnId: string, deviceId: string | null): Promise<Outcome<RedeemResult>> {
  const { data, error } = await supabase.rpc('confirm_redemption', {
    p_code: code, p_client_txn_id: txnId, p_device_id: deviceId,
  });
  if (error) return fail(error);
  return { ok: true, data: (Array.isArray(data) ? data[0] : data) as RedeemResult };
}
