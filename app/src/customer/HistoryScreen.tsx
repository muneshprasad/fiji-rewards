import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { describeTxn, fijiDate, Txn } from '../lib/history';
import { colors, fonts } from '../theme';
import { fetchHistory } from './api';

export default function HistoryScreen({ userId }: { userId: string }) {
  const [items, setItems] = useState<Txn[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { fetchHistory(userId).then((r) => { setItems(r); setFailed(r === null); }); }, [userId]);

  if (!items && !failed) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Text style={s.heading}>History</Text>
      {failed ? <Text style={s.empty}>Could not load your history. Check your connection.</Text> : (
        <FlatList data={items ?? []} keyExtractor={(t) => t.id} contentContainerStyle={{ padding: 20, gap: 10 }}
          ListEmptyComponent={<Text style={s.empty}>Nothing yet. Scan your QR code at a shop to earn points.</Text>}
          renderItem={({ item }) => {
            const d = describeTxn(item);
            return (
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{d.title}</Text>
                  <Text style={s.meta}>{d.detail ? `${d.detail} · ` : ''}{fijiDate(item.created_at)}</Text>
                </View>
                <Text style={[s.pts, { color: d.gain ? colors.teal : colors.dangerText }]}>{d.points}</Text>
              </View>
            );
          }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  heading: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink, paddingHorizontal: 20, paddingTop: 56 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  meta: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  pts: { fontFamily: fonts.extraBold, fontSize: 20, marginLeft: 12 },
  empty: { fontFamily: fonts.regular, color: colors.muted, textAlign: 'center', padding: 24 },
});
