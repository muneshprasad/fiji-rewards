import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { formatFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';

type Profile = { id: string; phone: string; name: string | null; language: string; referral_code: string };

export default function ProfileScreen({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      supabase.from('customers').select('id, phone, name, language, referral_code').eq('id', userId).maybeSingle(),
      supabase.from('customer_balances').select('balance').eq('customer_id', userId).maybeSingle(),
    ]);
    if (p.error) { setError('Could not load your profile. Pull to try again later.'); return; }
    setProfile(p.data); setName(p.data?.name ?? ''); setBalance(b.data?.balance ?? 0);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    const { error: err } = await supabase.from('customers').update({ name: name.trim() || null }).eq('id', userId);
    setSaving(false);
    if (err) setError('Could not save your name.'); else setSaved(true);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <View style={s.card}>
        <Text style={s.cardLabel}>Your points</Text>
        <Text style={s.points} accessibilityLabel={`${balance} points`}>{balance}</Text>
      </View>
      <Text style={s.phone}>{profile ? formatFijiPhone(profile.phone) : ' '}</Text>
      <Field label="Your name (optional)" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} autoComplete="name" />
      <ErrorNote message={error} />
      {saved ? <Text style={s.ok}>Saved.</Text> : null}
      <Button title="Save" onPress={save} loading={saving} />
      <Button title="Sign out" variant="ghost" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 64 },
  card: { backgroundColor: colors.deepTeal, borderRadius: 20, padding: 24, marginBottom: 12 },
  cardLabel: { color: colors.white, fontFamily: fonts.medium, fontSize: 15 },
  points: { color: colors.gold, fontFamily: fonts.extraBold, fontSize: 56 },
  phone: { fontFamily: fonts.medium, color: colors.muted, fontSize: 15, marginBottom: 20 },
  ok: { color: colors.teal, fontFamily: fonts.medium, marginBottom: 10 },
});
