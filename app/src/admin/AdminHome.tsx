import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, MIN_TOUCH } from '../theme';
import AdminScreen from './AdminScreen';
import SettlementScreen from './SettlementScreen';

/** The network admin area: fraud alerts and the monthly money statements. */
export default function AdminHome() {
  const [part, setPart] = useState<'alerts' | 'money'>('alerts');
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={s.bar}>
        {(['alerts', 'money'] as const).map((p) => (
          <Pressable key={p} onPress={() => setPart(p)} accessibilityRole="button" style={[s.seg, part === p && s.on]}>
            <Text style={[s.text, part === p && { color: colors.white }]}>{p === 'alerts' ? 'Alerts' : 'Money'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }}>{part === 'alerts' ? <AdminScreen /> : <SettlementScreen />}</View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 56 },
  seg: { flex: 1, minHeight: MIN_TOUCH, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  on: { backgroundColor: colors.teal, borderColor: colors.teal },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
});
