import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from '../components/QRCode';
import { Button } from '../components/ui';
import { customerQr } from '../lib/qr';
import { colors, fonts } from '../theme';

export default function HomeScreen({ userId, balance, onRefresh, onDeals }: {
  userId: string; balance: number | null; onRefresh: () => Promise<void>; onDeals: () => void;
}) {
  const [refreshing, setRefreshing] = React.useState(false);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await onRefresh(); setRefreshing(false); }} />}>
      <View style={s.card}>
        <Text style={s.label}>Your points</Text>
        <Text style={s.points} accessibilityLabel={`${balance ?? 0} points`}>{balance ?? '–'}</Text>
      </View>
      <View style={s.qrCard}>
        <QRCode value={customerQr(userId)} size={240} />
        <Text style={s.hint}>Show this code at the till to earn points.</Text>
      </View>
      <Button title="Browse deals" onPress={onDeals} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 56, gap: 16 },
  card: { backgroundColor: colors.deepTeal, borderRadius: 20, padding: 22 },
  label: { color: colors.white, fontFamily: fonts.medium, fontSize: 15 },
  points: { color: colors.gold, fontFamily: fonts.extraBold, fontSize: 56 },
  qrCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  hint: { fontFamily: fonts.regular, color: colors.muted, fontSize: 14, marginTop: 12, textAlign: 'center' },
});
