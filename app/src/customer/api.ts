import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { friendlyError, isNetworkError } from '../lib/errors';
import type { LatLng } from '../lib/geo';
import type { MerchantRow } from '../lib/deals';
import type { Txn } from '../lib/history';

export type RedemptionCode = { code: string; expires_at: string; points_cost: number; reward_title: string; merchant_name: string };

export async function fetchBalance(userId: string): Promise<number | null> {
  const { data, error } = await supabase.from('customer_balances').select('balance').eq('customer_id', userId).maybeSingle();
  if (error) return null;
  return data?.balance ?? 0;
}

export async function fetchMerchants(): Promise<MerchantRow[] | null> {
  const { data, error } = await supabase
    .from('merchants')
    .select('id, business_name, category, town, address, lat, lng, points_per_fjd, rewards(id, title, points_cost, value_fjd, active_from, active_to)')
    .eq('status', 'active');
  return error ? null : (data as unknown as MerchantRow[]);
}

export async function fetchHistory(userId: string, limit = 50): Promise<Txn[] | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, type, points_change, amount_fjd, created_at, note, merchant:merchants(business_name)')
    .eq('customer_id', userId).order('created_at', { ascending: false }).limit(limit);
  return error ? null : (data as unknown as Txn[]);
}

export async function currentPosition(): Promise<LatLng | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync();
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch { return null; }
}

export async function requestRedemption(rewardId: string): Promise<{ ok: true; data: RedemptionCode } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('create_redemption', { p_reward_id: rewardId });
  if (error) return { ok: false, message: friendlyError(error, isNetworkError(error)) };
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { ok: true, data: row as RedemptionCode } : { ok: false, message: friendlyError(null) };
}
