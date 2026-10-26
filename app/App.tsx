import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import PhoneScreen from './src/screens/PhoneScreen';
import OtpScreen from './src/screens/OtpScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import TillApp from './src/till/TillApp';
import { fetchStaff, StaffInfo } from './src/till/api';
import { isConfigured, supabase } from './src/lib/supabase';
import { colors, fonts } from './src/theme';

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  });
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [roleReady, setRoleReady] = useState(false);

  useEffect(() => {
    if (!isConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    setRoleReady(false);
    if (!userId) { setStaff(null); return; }
    fetchStaff(userId).then((st) => { setStaff(st); setRoleReady(true); });
  }, [userId]);

  if (!fontsLoaded || !ready || (session && !roleReady)) {
    return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  }
  if (!isConfigured) {
    return (
      <View style={s.center}>
        <Text style={s.msg}>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see app/.env.example).</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      {session ? (staff ? <TillApp staff={staff} /> : <ProfileScreen userId={session.user.id} />)
        : pendingPhone ? <OtpScreen phone={pendingPhone} onBack={() => setPendingPhone(null)} />
        : <PhoneScreen onSent={setPendingPhone} />}
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  msg: { fontFamily: fonts.regular, color: colors.ink, textAlign: 'center' },
});
