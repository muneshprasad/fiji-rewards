import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';

const key = (userId: string) => `fiji.qrSecret.${userId}`;

/** The customer's QR signing secret: kept in secure storage once fetched, so the code still works with no signal. */
export async function getQrSecret(userId: string): Promise<string | null> {
  try {
    const saved = await SecureStore.getItemAsync(key(userId));
    if (saved) return saved;
  } catch { /* fall through and fetch */ }
  const { data, error } = await supabase.from('customer_secrets').select('qr_secret').eq('customer_id', userId).maybeSingle();
  if (error || !data?.qr_secret) {
    if (__DEV__) console.warn('[qr secret] could not load:', error ? `${error.code ?? ''} ${error.message}` : 'no row for this customer');
    return null;
  }
  try { await SecureStore.setItemAsync(key(userId), data.qr_secret); } catch { /* still usable this session */ }
  return data.qr_secret;
}
