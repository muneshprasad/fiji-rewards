import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { fjd } from '../lib/money';
import { daysOld, QueuedSale, WARN_AFTER_DAYS } from '../lib/queue';
import { fijiDate } from '../lib/history';
import { colors, fonts } from '../theme';
import { saleQueue, syncNow, useQueuedSales } from './offline';

export default function QueueScreen({ onBack }: { onBack: () => void }) {
  const sales = useQueuedSales();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true); setMsg(null);
    const r = await syncNow();
    setBusy(false);
    setMsg(r.stoppedOffline ? 'Still no signal. Sales stay saved on this phone.'
      : r.sent || r.rejected ? `${r.sent} sent${r.rejected ? `, ${r.rejected} refused` : ''}.` : 'Nothing to send.');
  }
  function discard(s: QueuedSale) {
    Alert.alert('Discard this sale?', `${s.customerLabel} will not get points for ${fjd(s.amount)}.`, [
      { text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => saleQueue.discard(s.id) },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Text style={s.title}>Sales waiting to send</Text>
      {sales.length === 0 ? <Text style={s.empty}>Nothing waiting. All sales are sent.</Text> : null}
      {sales.map((x) => (
        <View key={x.id} style={[s.card, x.status === 'rejected' && s.cardBad]}>
          <Text style={s.name}>{x.customerLabel} · {fjd(x.amount)}</Text>
          <Text style={s.meta}>{fijiDate(x.occurredAt)}{x.attempts ? ` · tried ${x.attempts} time${x.attempts === 1 ? '' : 's'}` : ''}</Text>
          {x.status === 'rejected' ? <Text style={s.bad}>Refused: {x.lastError}</Text> : null}
          {x.status === 'pending' && daysOld(x) >= WARN_AFTER_DAYS ? <Text style={s.warn}>Send soon. Sales older than 7 days are refused.</Text> : null}
          <Button title="Discard" variant="ghost" onPress={() => discard(x)} />
        </View>
      ))}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}
      <Button title="Send now" onPress={sync} loading={busy} disabled={saleQueue.pendingCount() === 0} />
      <Button title="Back" variant="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 56, gap: 8 },
  title: { fontFamily: fonts.extraBold, fontSize: 26, color: colors.ink, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, color: colors.muted, fontSize: 16 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  cardBad: { borderColor: colors.dangerText },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  meta: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  bad: { fontFamily: fonts.medium, color: colors.dangerText, marginTop: 6 },
  warn: { fontFamily: fonts.medium, color: colors.ink, backgroundColor: colors.warning, padding: 8, borderRadius: 8, marginTop: 6 },
  msg: { fontFamily: fonts.medium, color: colors.teal, marginVertical: 8 },
});
