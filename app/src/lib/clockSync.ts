import AsyncStorage from '@react-native-async-storage/async-storage';
import { offsetFromReading, setClockOffset } from './clock';
import { supabase } from './supabase';

const KEY = 'fiji.clockOffset';

/** Restores the last known offset, then (if online) refreshes it from the server. Never throws. */
export async function syncClock(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) setClockOffset(Number(saved));
  } catch { /* use the phone clock */ }
  try {
    const sent = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const { data, error } = await supabase.rpc('server_time').abortSignal(ctl.signal);
    clearTimeout(timer);
    const received = Date.now();
    if (error || typeof data !== 'number') return;
    const offset = offsetFromReading(data, sent, received);
    setClockOffset(offset);
    await AsyncStorage.setItem(KEY, String(offset));
  } catch { /* offline: keep what we have */ }
}
