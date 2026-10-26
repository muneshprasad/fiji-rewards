import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { buildDeals, categoriesOf, Deal, filterByCategory } from '../lib/deals';
import { formatDistance, LatLng } from '../lib/geo';
import { colors, fonts, MIN_TOUCH } from '../theme';
import { currentPosition, fetchMerchants } from './api';
import type { MerchantRow } from '../lib/deals';

export default function DealsScreen({ onOpen }: { onOpen: (d: Deal) => void }) {
  const [rows, setRows] = useState<MerchantRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [here, setHere] = useState<LatLng | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchMerchants().then((r) => { setRows(r); setFailed(r === null); });
    currentPosition().then(setHere);
  }, []);

  const deals = useMemo(() => buildDeals(rows ?? [], here), [rows, here]);
  const shown = filterByCategory(deals, category);

  if (!rows && !failed) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  if (failed) return <View style={s.center}><Text style={s.empty}>Could not load deals. Check your connection.</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Text style={s.heading}>Deals</Text>
      <View style={s.chips}>
        {[null, ...categoriesOf(deals)].map((c) => (
          <Pressable key={c ?? 'all'} onPress={() => setCategory(c)} accessibilityRole="button"
            style={[s.chip, category === c && s.chipOn]}>
            <Text style={[s.chipText, category === c && { color: colors.white }]}>{c ?? 'All'}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={shown} keyExtractor={(d) => d.id} contentContainerStyle={{ padding: 20, gap: 12 }}
        ListEmptyComponent={<Text style={s.empty}>No deals yet.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} accessibilityRole="button" style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.business_name}</Text>
              <Text style={s.meta}>{item.category} · {item.town}{item.distanceKm !== null ? ` · ${formatDistance(item.distanceKm)}` : ''}</Text>
              {item.cheapest ? <Text style={s.deal}>{item.cheapest.title} · {item.cheapest.points_cost} pts</Text> : null}
            </View>
            <Text style={s.chev}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  heading: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink, paddingHorizontal: 20, paddingTop: 56 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { fontFamily: fonts.medium, color: colors.ink, fontSize: 15 },
  row: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  meta: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 2 },
  deal: { fontFamily: fonts.medium, fontSize: 14, color: colors.teal, marginTop: 6 },
  chev: { fontSize: 28, color: colors.muted, marginLeft: 8 },
  empty: { fontFamily: fonts.regular, color: colors.muted, textAlign: 'center', marginTop: 24 },
});
