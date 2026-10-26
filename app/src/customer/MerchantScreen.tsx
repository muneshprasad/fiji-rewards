import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import type { Deal, Reward } from '../lib/deals';
import { formatDistance } from '../lib/geo';
import { colors, fonts } from '../theme';

export default function MerchantScreen({ deal, balance, onRedeem, onBack }: {
  deal: Deal; balance: number | null; onRedeem: (r: Reward) => void; onBack: () => void;
}) {
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Button title="‹ Back" variant="ghost" onPress={onBack} />
      <Text style={s.name}>{deal.business_name}</Text>
      <Text style={s.meta}>{deal.category} · {deal.town}{deal.distanceKm !== null ? ` · ${formatDistance(deal.distanceKm)}` : ''}</Text>
      {deal.address ? <Text style={s.meta}>{deal.address}</Text> : null}
      <Text style={s.earn}>Earn {deal.points_per_fjd} point{Number(deal.points_per_fjd) === 1 ? '' : 's'} for every FJD 1 you spend</Text>
      <Text style={s.section}>Rewards</Text>
      {deal.rewards.map((r) => {
        const can = (balance ?? 0) >= r.points_cost;
        return (
          <View key={r.id} style={s.reward}>
            <Text style={s.rTitle}>{r.title}</Text>
            <Text style={s.meta}>{r.points_cost} points · worth FJD {Number(r.value_fjd).toFixed(2)}</Text>
            <View style={{ height: 8 }} />
            <Button title={can ? 'Redeem' : `Need ${r.points_cost - (balance ?? 0)} more points`} disabled={!can} onPress={() => onRedeem(r)} />
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 48 },
  name: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink },
  meta: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, marginTop: 2 },
  earn: { fontFamily: fonts.medium, fontSize: 15, color: colors.teal, marginTop: 12 },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, marginTop: 24, marginBottom: 8 },
  reward: { backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  rTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
});
