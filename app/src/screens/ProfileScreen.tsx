import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { formatFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';

type Profile = { id: string; phone: string; name: string | null; language: string; referral_code: string; sms_receipts: boolean };

export default function ProfileScreen({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      supabase.from('customers').select('id, phone, name, language, referral_code, sms_receipts').eq('id', userId).maybeSingle(),
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

  async function setReceipts(on: boolean) {
    if (!profile) return;
    setProfile({ ...profile, sms_receipts: on });
    const { error: err } = await supabase.from('customers').update({ sms_receipts: on }).eq('id', userId);
    if (err) { setProfile({ ...profile, sms_receipts: !on }); setError('Could not change this setting. Try again.'); }
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
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>Text me a receipt</Text>
          <Text style={s.rowSub}>An SMS after each sale or reward.</Text>
        </View>
        <Switch value={profile?.sms_receipts ?? true} onValueChange={setReceipts} disabled={!profile}
          trackColor={{ true: colors.teal, false: colors.border }} accessibilityLabel="Text me a receipt" />
      </View>
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
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, marginTop: 12, paddingVertical: 8 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  ok: { color: colors.teal, fontFamily: fonts.medium, marginBottom: 10 },
});
