import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote } from '../components/ui';
import { fjd } from '../lib/money';
import { describeNet, monthLabel, NetworkSummary, previousMonth, SettlementRow, shiftMonth, STATUS_LABEL } from '../lib/settlement';
import { colors, fonts } from '../theme';
import { calculateStatements, fetchSettlements, fetchSummary, setSettlementStatus } from './api';

export default function SettlementScreen() {
  const [month, setMonth] = useState(previousMonth());
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSummary(null); setRows(null); setError(null);
    const [s, r] = await Promise.all([fetchSummary(month), fetchSettlements(month)]);
    if (!s || !r) { setError('Could not load. Check your connection and that you are a network admin.'); return; }
    setSummary(s); setRows(r);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function calculate() {
    setBusy(true);
    const r = await calculateStatements(month);
    setBusy(false);
    if (!r.ok) { setError(r.message.includes('month') ? 'That month has not started yet.' : r.message); return; }
    load();
  }
  function change(row: SettlementRow, to: 'issued' | 'paid') {
    const what = to === 'issued' ? 'Issue this statement? Shops will see it and it can no longer change.' : 'Mark as paid? Do this after the money has actually moved.';
    Alert.alert(`${row.merchant?.business_name ?? 'Shop'}: ${describeNet(row.net_amount).text}`, what, [
      { text: 'Cancel', style: 'cancel' },
      { text: to === 'issued' ? 'Issue' : 'Mark paid', onPress: async () => { const r = await setSettlementStatus(row.id, to); if (!r.ok) setError(r.message); load(); } },
    ]);
  }

  const drafts = rows?.some((r) => r.status === 'draft');
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <View style={s.monthBar}>
        <Button title="‹" variant="ghost" onPress={() => setMonth(shiftMonth(month, -1))} />
        <Text style={s.month}>{monthLabel(month)}</Text>
        <Button title="›" variant="ghost" onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>
      <ErrorNote message={error} />
      {!summary && !error ? <ActivityIndicator color={colors.teal} /> : null}

      {summary ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>What the network earned</Text>
          <Text style={s.big}>{fjd(summary.network_earnings)}</Text>
          <Line k="Margin on points issued" v={fjd(summary.margin_on_issue)} />
          <Line k="Points that expired unused" v={`${summary.points_expired} pts, ${fjd(summary.breakage_value)}`} />
          <Line k="Monthly shop fees" v={fjd(summary.monthly_fees)} />
          <View style={s.rule} />
          <Text style={s.cardTitle}>Money moving</Text>
          <Line k="In from shops (issue charges + fees)" v={fjd(summary.cash_in)} />
          <Line k="Out to shops (rewards redeemed)" v={fjd(summary.cash_out)} />
          <Line k="Net cash this month" v={fjd(summary.net_cash)} bold />
          <View style={s.rule} />
          <Line k="Points issued / redeemed" v={`${summary.points_issued} / ${summary.points_redeemed}`} />
          <Line k="Points still held by customers" v={`${summary.outstanding_points} pts`} />
          <Line k="Owed to future redemptions" v={fjd(summary.outstanding_liability)} bold />
          <Text style={s.fine}>Keep the "owed to future redemptions" amount set aside: it is money that shops will claim when customers spend their points.</Text>
        </View>
      ) : null}

      <Button title={drafts || !rows?.length ? 'Calculate statements' : 'Recalculate drafts'} onPress={calculate} loading={busy} />

      {rows?.length === 0 ? <Text style={s.fine}>No statements yet for this month. Tap Calculate.</Text> : null}
      {rows?.map((r) => {
        const net = describeNet(r.net_amount);
        return (
          <View key={r.id} style={s.card}>
            <Text style={s.cardTitle}>{r.merchant?.business_name ?? 'Shop'}</Text>
            <Text style={[s.net, net.tone === 'receive' && { color: colors.teal }]}>{net.text}</Text>
            <Line k={`Points issued ${r.points_issued}`} v={`charge ${fjd(r.issue_charge)}`} />
            <Line k={`Points redeemed ${r.points_redeemed}`} v={`reimbursed ${fjd(r.reimbursement)}`} />
            {r.monthly_fee > 0 ? <Line k="Monthly fee" v={fjd(r.monthly_fee)} /> : null}
            <Text style={s.status}>{STATUS_LABEL[r.status]}</Text>
            {r.status === 'draft' ? <Button title="Issue statement" variant="ghost" onPress={() => change(r, 'issued')} /> : null}
            {r.status === 'issued' ? <Button title="Mark as paid" variant="ghost" onPress={() => change(r, 'paid')} /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const Line = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <View style={s.line}><Text style={[s.k, bold && s.bold]}>{k}</Text><Text style={[s.v, bold && s.bold]}>{v}</Text></View>
);

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 8, gap: 10 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { fontFamily: fonts.extraBold, fontSize: 22, color: colors.ink },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  big: { fontFamily: fonts.extraBold, fontSize: 34, color: colors.deepTeal, marginVertical: 4 },
  net: { fontFamily: fonts.extraBold, fontSize: 20, color: colors.ink, marginVertical: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  k: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  v: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  bold: { fontFamily: fonts.bold, color: colors.ink },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  fine: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
  status: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 8 },
});
