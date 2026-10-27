import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote } from '../components/ui';
import { alertSummary, alertTitle, AlertRow, sortAlerts } from '../lib/alerts';
import { fijiDate } from '../lib/history';
import { formatFijiPhone } from '../lib/phone';
import { colors, fonts } from '../theme';
import { fetchOpenAlerts, handleAlert, suspendCustomer, suspendMerchant } from './api';

const SEVERITY_COLOR = { high: colors.dangerText, medium: colors.ink, low: colors.muted } as const;

export default function AdminScreen() {
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchOpenAlerts();
    if (r) { setRows(sortAlerts(r)); setError(null); } else setError('Could not load alerts. Check your connection.');
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(p: Promise<{ ok: true } | { ok: false; message: string }>) {
    const r = await p;
    if (!r.ok) setError(r.message); else setError(null);
    load();
  }
  function confirmSuspend(label: string, then: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    Alert.alert(`Suspend ${label}?`, 'They will not be able to earn or redeem until you turn this back on.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Suspend', style: 'destructive', onPress: () => run(then()) },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Text style={s.title}>Alerts</Text>
      <ErrorNote message={error} />
      {!rows && !error ? <ActivityIndicator color={colors.teal} /> : null}
      {rows && rows.length === 0 ? <Text style={s.sub}>No open alerts.</Text> : null}
      {rows?.map((a) => (
        <View key={a.id} style={s.card}>
          <Text style={[s.sev, { color: SEVERITY_COLOR[a.severity] }]}>{a.severity.toUpperCase()} · {fijiDate(a.created_at)}</Text>
          <Text style={s.name}>{alertTitle(a.kind)}</Text>
          <Text style={s.sub}>{alertSummary(a)}</Text>
          {a.merchant ? <Text style={s.sub}>Shop: {a.merchant.business_name}</Text> : null}
          {a.staff ? <Text style={s.sub}>Cashier: {a.staff.name}</Text> : null}
          {a.customer ? <Text style={s.sub}>Customer: {a.customer.name ?? formatFijiPhone(a.customer.phone)}</Text> : null}
          <View style={{ height: 8 }} />
          <Button title="Dismiss" variant="ghost" onPress={() => run(handleAlert(a.id, 'dismissed'))} />
          <Button title="Mark as handled" variant="ghost" onPress={() => run(handleAlert(a.id, 'actioned'))} />
          {a.customer_id ? <Button title="Suspend customer" variant="ghost"
            onPress={() => confirmSuspend('this customer', () => suspendCustomer(a.customer_id!, alertTitle(a.kind)))} /> : null}
          {a.merchant_id ? <Button title="Suspend shop" variant="ghost"
            onPress={() => confirmSuspend('this shop', () => suspendMerchant(a.merchant_id!, alertTitle(a.kind)))} /> : null}
        </View>
      ))}
      <Button title="Refresh" onPress={load} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 8, gap: 10 },
  title: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  sev: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 2 },
});
