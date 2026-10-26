import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { fjd, parseAmount, pointsFor } from '../lib/money';
import { formatFijiPhone, normalizeFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';
import { CustomerInfo, earn, EarnResult, lookupCustomer, newTxnId, redeem, RedeemResult, StaffInfo } from './api';
import ScanScreen from './ScanScreen';

type View_ =
  | { name: 'home' }
  | { name: 'scan-customer' } | { name: 'type-customer' }
  | { name: 'scan-code' } | { name: 'type-code' }
  | { name: 'sale'; customer: CustomerInfo }
  | { name: 'earned'; customer: CustomerInfo; amount: number; result: EarnResult }
  | { name: 'redeemed'; result: RedeemResult };

export default function TillApp({ staff }: { staff: StaffInfo }) {
  const [view, setView] = useState<View_>({ name: 'home' });
  const [notice, setNotice] = useState<string | null>(null);
  const home = () => setView({ name: 'home' });

  async function findCustomer(by: { customerId?: string; phone?: string }) {
    const r = await lookupCustomer(by);
    if (!r.ok) { setNotice(r.message); setView({ name: 'home' }); return; }
    setNotice(null); setView({ name: 'sale', customer: r.data });
  }
  async function useCode(code: string) {
    const r = await redeem(code, newTxnId(), null);
    if (!r.ok) { setNotice(r.message); setView({ name: 'home' }); return; }
    setNotice(null); setView({ name: 'redeemed', result: r.data });
  }

  switch (view.name) {
    case 'scan-customer':
      return <ScanScreen title="Scan the customer's QR code" want="customer"
        onScan={(sc) => sc.kind === 'customer' && findCustomer({ customerId: sc.customerId })}
        onTypeInstead={() => setView({ name: 'type-customer' })} onCancel={home} />;
    case 'scan-code':
      return <ScanScreen title="Scan the redemption QR code" want="redeem"
        onScan={(sc) => sc.kind === 'redeem' && useCode(sc.code)}
        onTypeInstead={() => setView({ name: 'type-code' })} onCancel={home} />;
    case 'type-customer':
      return <TypeCustomer onFound={findCustomer} onCancel={home} />;
    case 'type-code':
      return <TypeCode onSubmit={useCode} onCancel={home} />;
    case 'sale':
      return <Sale staff={staff} customer={view.customer} onCancel={home}
        onDone={(amount, result) => setView({ name: 'earned', customer: view.customer, amount, result })} />;
    case 'earned':
      return <Done title="Sale recorded" lines={[
        `${view.customer.name ?? formatFijiPhone(view.customer.phone)}`, fjd(view.amount),
        `+${view.result.points_earned} points earned`, `New balance: ${view.result.new_balance} points`,
      ]} onDone={home} />;
    case 'redeemed':
      return <Done title="Reward redeemed" lines={[
        view.result.reward_title, `${view.result.points_spent} points spent (worth ${fjd(view.result.value_fjd)})`,
        `Customer balance: ${view.result.new_balance} points`,
      ]} onDone={home} />;
    default:
      return (
        <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={s.wrap}>
          <Text style={s.shop}>{staff.merchant.business_name}</Text>
          <Text style={s.who}>Signed in as {staff.name}</Text>
          {notice ? <View style={s.notice}><Text style={s.noticeText}>{notice}</Text></View> : null}
          <View style={{ gap: 12, marginTop: 24 }}>
            <Button title="Scan customer QR" onPress={() => { setNotice(null); setView({ name: 'scan-customer' }); }} />
            <Button title="Type customer number" variant="ghost" onPress={() => { setNotice(null); setView({ name: 'type-customer' }); }} />
            <View style={s.rule} />
            <Button title="Redeem a code" onPress={() => { setNotice(null); setView({ name: 'scan-code' }); }} />
          </View>
          <Button title="Sign out" variant="ghost" onPress={() => supabase.auth.signOut()} />
        </ScrollView>
      );
  }
}

function TypeCustomer({ onFound, onCancel }: { onFound: (by: { phone: string }) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <View style={s.form}>
      <Text style={s.title}>Customer number</Text>
      <Field label="Mobile number" value={v} onChangeText={setV} keyboardType="phone-pad" placeholder="700 1234" autoFocus />
      <ErrorNote message={err} />
      <Button title="Find customer" loading={busy} onPress={async () => {
        const phone = normalizeFijiPhone(v);
        if (!phone) { setErr('Enter a Fiji mobile number.'); return; }
        setErr(null); setBusy(true); await onFound({ phone }); setBusy(false);
      }} />
      <Button title="Back" variant="ghost" onPress={onCancel} />
    </View>
  );
}

function TypeCode({ onSubmit, onCancel }: { onSubmit: (code: string) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <View style={s.form}>
      <Text style={s.title}>Redemption code</Text>
      <Field label="6-digit code" value={v} onChangeText={(t) => setV(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad" maxLength={6} autoFocus />
      <ErrorNote message={err} />
      <Button title="Redeem" loading={busy} onPress={async () => {
        if (!/^\d{6}$/.test(v)) { setErr('Enter the 6-digit code.'); return; }
        setErr(null); setBusy(true); await onSubmit(v); setBusy(false);
      }} />
      <Button title="Back" variant="ghost" onPress={onCancel} />
    </View>
  );
}

function Sale({ staff, customer, onDone, onCancel }: {
  staff: StaffInfo; customer: CustomerInfo; onDone: (amount: number, r: EarnResult) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const txnId = useRef(newTxnId()).current;   // one id per sale, so a retry can never earn twice
  const amount = parseAmount(v);
  const preview = amount ? pointsFor(amount, staff.merchant.points_per_fjd) : null;
  return (
    <View style={s.form}>
      <Text style={s.title}>{customer.name ?? formatFijiPhone(customer.phone)}</Text>
      <Text style={s.who}>{customer.balance} points now</Text>
      <View style={{ height: 20 }} />
      <Field label="Bill amount (FJD)" value={v} onChangeText={setV} keyboardType="decimal-pad" placeholder="0.00" autoFocus />
      {preview !== null ? <Text style={s.preview}>Customer earns {preview} points</Text> : null}
      <ErrorNote message={err} />
      <Button title="Confirm sale" loading={busy} disabled={!amount} onPress={async () => {
        if (!amount) return;
        setErr(null); setBusy(true);
        const r = await earn(customer.customer_id, amount, txnId, null);
        setBusy(false);
        if (r.ok) onDone(amount, r.data); else setErr(r.message);
      }} />
      <Button title="Cancel" variant="ghost" onPress={onCancel} />
    </View>
  );
}

function Done({ title, lines, onDone }: { title: string; lines: string[]; onDone: () => void }) {
  return (
    <View style={s.form}>
      <Text style={[s.title, { color: colors.teal }]}>{title}</Text>
      {lines.map((l, i) => <Text key={i} style={s.line}>{l}</Text>)}
      <View style={{ height: 24 }} />
      <Button title="Done" onPress={onDone} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 64 },
  form: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  shop: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink },
  who: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, marginTop: 4 },
  title: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink, marginBottom: 8 },
  line: { fontFamily: fonts.medium, fontSize: 18, color: colors.ink, marginTop: 6 },
  preview: { fontFamily: fonts.bold, fontSize: 16, color: colors.teal, marginBottom: 12 },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  notice: { backgroundColor: colors.warning, borderRadius: 12, padding: 14, marginTop: 16 },
  noticeText: { fontFamily: fonts.medium, color: colors.ink, fontSize: 15 },
});
