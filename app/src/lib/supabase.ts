import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// A placeholder such as "PASTE-ANON-KEY-HERE" must never count as configured.
export const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url ?? '') && (anonKey ?? '').length > 20 && !/PASTE|SET-IN/i.test(anonKey ?? '');

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
