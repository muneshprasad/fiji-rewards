import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from '../components/QRCode';
import { Button, ErrorNote } from '../components/ui';
import { countdown } from '../lib/history';
import { redeemQr } from '../lib/qr';
import { colors, fonts } from '../theme';
import { RedemptionCode, requestRedemption } from './api';

export default function RedeemScreen({ rewardId, onDone }: { rewardId: string; onDone: () => void }) {
  const [code, setCode] = useState<RedemptionCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setError(null); setCode(null);
    const r = await requestRedemption(rewardId);
    if (r.ok) setCode(r.data); else setError(r.message);
  }, [rewardId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (error) return (
    <View style={s.center}><ErrorNote message={error} /><Button title="Back" onPress={onDone} /></View>
  );
  if (!code) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;

  const left = countdown(code.expires_at, now);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Text style={s.shop}>{code.merchant_name}</Text>
      <Text style={s.reward}>{code.reward_title} · {code.points_cost} points</Text>
      {left.expired ? (
        <View style={s.card}>
          <Text style={s.expired}>This code has expired</Text>
          <Button title="Get a new code" onPress={load} />
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.code} accessibilityLabel={`Code ${code.code.split('').join(' ')}`}>{code.code}</Text>
          <QRCode value={redeemQr(code.code)} size={220} />
          <Text style={s.timer}>Expires in {left.text}</Text>
          <Text style={s.hint}>Show this to the cashier. It works once and only at this shop. Points are taken when they confirm.</Text>
        </View>
      )}
      <Button title="Done" variant="ghost" onPress={onDone} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  wrap: { padding: 20, paddingTop: 56, gap: 8 },
  shop: { fontFamily: fonts.extraBold, fontSize: 26, color: colors.ink },
  reward: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted, marginBottom: 8 },
  card: { backgroundColor: colors.white, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: colors.border, gap: 12 },
  code: { fontFamily: fonts.extraBold, fontSize: 48, letterSpacing: 6, color: colors.deepTeal },
  timer: { fontFamily: fonts.bold, fontSize: 18, color: colors.teal },
  hint: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, textAlign: 'center' },
  expired: { fontFamily: fonts.bold, fontSize: 18, color: colors.dangerText },
});
