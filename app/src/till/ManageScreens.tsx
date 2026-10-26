import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { fjd } from '../lib/money';
import { parseRate, rewardStatus, validateReward, RewardErrors } from '../lib/manage';
import { colors, fonts } from '../theme';
import type { StaffInfo } from './api';
import { endReward, fetchNetworkLimits, fetchRewards, fetchToday, ManagedReward, saveRate, saveReward, Today } from './manage';

export function TodayScreen({ staff, onBack }: { staff: StaffInfo; onBack: () => void }) {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const r = await fetchToday();
    if (r.ok) setData(r.data); else setError(r.message);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Text style={s.title}>Today</Text>
      <Text style={s.sub}>{staff.merchant.business_name}{data ? ` · ${data.day}` : ''}</Text>
      <ErrorNote message={error} />
      {!data && !error ? <ActivityIndicator color={colors.teal} /> : null}
      {data ? (
        <View style={s.grid}>
          <Stat label="Sales" value={String(data.sales_count)} />
          <Stat label="Sales total" value={fjd(data.sales_fjd)} />
          <Stat label="Points given" value={String(data.points_issued)} />
          <Stat label="Rewards redeemed" value={String(data.redemptions_count)} />
          <Stat label="Points redeemed" value={String(data.points_redeemed)} />
          <Stat label="Customers" value={String(data.customers)} />
        </View>
      ) : null}
      <Button title="Refresh" onPress={load} />
      <Button title="Back" variant="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>
);

type Draft = { id: string | null; title: string; points: string; value: string; dailyLimit: string };
const blank: Draft = { id: null, title: '', points: '', value: '', dailyLimit: '' };

export function RewardsScreen({ staff, onBack }: { staff: StaffInfo; onBack: () => void }) {
  const merchantId = staff.merchant.id;
  const [rewards, setRewards] = useState<ManagedReward[] | null>(null);
  const [limits, setLimits] = useState({ min: 0.5, max: 5 });
  const [rate, setRate] = useState(String(staff.merchant.points_per_fjd));
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<RewardErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchRewards(merchantId);
    if (r.ok) { setRewards(r.data); setError(null); } else setError(r.message);
  }, [merchantId]);
  useEffect(() => { load(); fetchNetworkLimits().then(setLimits); }, [load]);

  async function submit() {
    if (!draft) return;
    const v = validateReward(draft);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setBusy(true);
    const r = await saveReward(merchantId, draft.id, v.values);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setDraft(null); setError(null); load();
  }
  function stop(r: ManagedReward) {
    Alert.alert('End this reward?', `"${r.title}" will no longer be offered. Customers with an open code can still use it until it expires.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'End reward', style: 'destructive', onPress: async () => { const x = await endReward(r); if (!x.ok) setError(x.message); load(); } },
    ]);
  }
  async function updateRate() {
    const n = parseRate(rate, limits.min, limits.max);
    if (n === null) { setRateMsg(`Enter a rate from ${limits.min} to ${limits.max}.`); return; }
    const r = await saveRate(merchantId, n);
    setRateMsg(r.ok ? 'Saved. New sales use this rate.' : r.message);
  }

  if (draft) {
    return (
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
        <Text style={s.title}>{draft.id ? 'Edit reward' : 'New reward'}</Text>
        <Field label="Name" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} error={errors.title} placeholder="Free coffee" />
        <Field label="Points it costs" value={draft.points} onChangeText={(t) => setDraft({ ...draft, points: t })} keyboardType="number-pad" error={errors.points} />
        <Field label="Worth (FJD)" value={draft.value} onChangeText={(t) => setDraft({ ...draft, value: t })} keyboardType="decimal-pad" error={errors.value} />
        <Field label="Limit per day (optional)" value={draft.dailyLimit} onChangeText={(t) => setDraft({ ...draft, dailyLimit: t })} keyboardType="number-pad" error={errors.dailyLimit} />
        <ErrorNote message={error} />
        <Button title="Save reward" onPress={submit} loading={busy} />
        <Button title="Cancel" variant="ghost" onPress={() => { setDraft(null); setErrors({}); }} />
      </ScrollView>
    );
  }

  const shown = (rewards ?? []).filter((r) => rewardStatus(r) !== 'ended');
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
      <Text style={s.title}>Rewards and points rate</Text>
      <View style={s.card}>
        <Field label={`Points per FJD 1 spent (${limits.min} to ${limits.max})`} value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        {rateMsg ? <Text style={s.msg}>{rateMsg}</Text> : null}
        <Button title="Save rate" onPress={updateRate} />
      </View>
      <Text style={s.section}>Rewards</Text>
      <ErrorNote message={error} />
      {!rewards && !error ? <ActivityIndicator color={colors.teal} /> : null}
      {rewards && shown.length === 0 ? <Text style={s.sub}>No rewards yet. Add one so customers have something to redeem.</Text> : null}
      {shown.map((r) => (
        <View key={r.id} style={s.card}>
          <Text style={s.name}>{r.title}</Text>
          <Text style={s.sub}>
            {r.points_cost} points · worth {fjd(r.value_fjd)}{r.daily_limit ? ` · ${r.daily_limit} a day` : ''}
            {rewardStatus(r) === 'scheduled' ? ' · starts later' : ''}
          </Text>
          <Button title="Edit" variant="ghost" onPress={() => setDraft({ id: r.id, title: r.title, points: String(r.points_cost), value: String(r.value_fjd), dailyLimit: r.daily_limit ? String(r.daily_limit) : '' })} />
          <Button title="End reward" variant="ghost" onPress={() => stop(r)} />
        </View>
      ))}
      <Button title="Add a reward" onPress={() => { setError(null); setDraft(blank); }} />
      <Button title="Back" variant="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 56, gap: 8 },
  title: { fontFamily: fonts.extraBold, fontSize: 26, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, marginTop: 2 },
  section: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, marginTop: 16 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  msg: { fontFamily: fonts.medium, color: colors.teal, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 12 },
  stat: { width: '48%', backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  statValue: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.deepTeal },
  statLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 2 },
});
