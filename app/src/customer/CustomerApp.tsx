import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Deal } from '../lib/deals';
import ProfileScreen from '../screens/ProfileScreen';
import { colors, fonts, MIN_TOUCH } from '../theme';
import { fetchBalance } from './api';
import DealsScreen from './DealsScreen';
import HistoryScreen from './HistoryScreen';
import HomeScreen from './HomeScreen';
import MerchantScreen from './MerchantScreen';
import RedeemScreen from './RedeemScreen';

type Tab = 'home' | 'deals' | 'history' | 'account';
const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'deals', label: 'Deals' }, { key: 'history', label: 'History' }, { key: 'account', label: 'Account' },
];

export default function CustomerApp({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('home');
  const [deal, setDeal] = useState<Deal | null>(null);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const refresh = useCallback(async () => { setBalance(await fetchBalance(userId)); }, [userId]);
  useEffect(() => { refresh(); }, [refresh, tab]);

  // Full-screen flows sit above the tabs.
  if (rewardId) return <RedeemScreen rewardId={rewardId} onDone={() => { setRewardId(null); refresh(); }} />;
  if (deal) return <MerchantScreen deal={deal} balance={balance} onRedeem={(r) => setRewardId(r.id)} onBack={() => setDeal(null)} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen userId={userId} balance={balance} onRefresh={refresh} onDeals={() => setTab('deals')} />}
        {tab === 'deals' && <DealsScreen onOpen={setDeal} />}
        {tab === 'history' && <HistoryScreen userId={userId} />}
        {tab === 'account' && <ProfileScreen userId={userId} />}
      </View>
      <View style={s.bar} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} style={s.tab}>
            <Text style={[s.label, tab === t.key && s.on]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 12 },
  tab: { flex: 1, minHeight: MIN_TOUCH + 4, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  on: { fontFamily: fonts.extraBold, color: colors.teal },
});
