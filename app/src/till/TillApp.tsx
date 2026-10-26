import React, { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { fjd, parseAmount, pointsFor } from '../lib/money';
import { MAX_SCANS_PER_HOUR } from '../lib/queue';
import { formatFijiPhone, normalizeFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';
import { CustomerInfo, earn, EarnResult, lookupCustomer, newTxnId, redeem, RedeemResult, StaffInfo } from './api';
import ScanScreen from './ScanScreen';
import QueueScreen from './QueueScreen';
import { getDeviceId, saleQueue, syncNow, useQueuedSales } from './offline';

type View_ =
  | { name: 'home' }
  | { name: 'scan-customer' } | { name: 'type-customer' }
  | { name: 'scan-code' } | { name: 'type-code' }
  | { name: 'sale'; customer: CustomerInfo; offline?: boolean }
  | { name: 'earned'; customer: CustomerInfo; amount: number; result: EarnResult }
  | { name: 'queued'; label: string; amount: number; estimate: number }
  | { name: 'queue' }
  | { name: 'redeemed'; result: RedeemResult };

export default function TillApp({ staff }: { staff: StaffInfo }) {
  const [view, setView] = useState<View_>({ name: 'home' });
  const [notice, setNotice] = useState<string | null>(null);
  const home = () => setView({ name: 'home' });
  const queued = useQueuedSales();

  // Load saved sales on start, then try to send them on start, on return to the app, and every 30 seconds while any wait.
  useEffect(() => {
    let alive = true;
    saleQueue.load().then(() => { if (alive) syncNow(); });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') syncNow(); });
    const timer = setInterval(() => { if (saleQueue.pendingCount() > 0) syncNow(); }, 30000);
    return () => { alive = false; sub.remove(); clearInterval(timer); };
  }, []);

  async function findCustomer(by: { customerId?: string; phone?: string }) {
    const r = await lookupCustomer(by);
    if (!r.ok && r.offline && by.customerId) {
      // No signal, but the QR already tells us who this is: carry on and save the sale on this phone.
      setNotice(null);
      setView({ name: 'sale', offline: true, customer: { customer_id: by.customerId, name: null, phone: '', balance: null } });
      return;
    }
    if (!r.ok) {
      setNotice(r.offline ? 'No signal. Scan the customer\'s QR code instead, because typed numbers need a connection.' : r.message);
      setView({ name: 'home' }); return;
    }
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
      return <Sale staff={staff} customer={view.customer} offline={view.offline} onCancel={home}
        onDone={(amount, result) => setView({ name: 'earned', customer: view.customer, amount, result })}
        onQueued={(label, amount, estimate) => setView({ name: 'queued', label, amount, estimate })} />;
    case 'queued':
      return <Done title="Saved on this phone" lines={[
        view.label, fjd(view.amount), `About ${view.estimate} points, confirmed when sent`,
        'No signal right now. This sale will be sent automatically when the phone is back online.',
      ]} onDone={home} />;
    case 'queue':
      return <QueueScreen onBack={home} />;
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
          {queued.length > 0 ? (
            <View style={s.notice}>
              <Text style={s.noticeText}>
                {saleQueue.pendingCount() > 0 ? `${saleQueue.pendingCount()} sale${saleQueue.pendingCount() === 1 ? '' : 's'} waiting to send. ` : ''}
                {saleQueue.rejectedCount() > 0 ? `${saleQueue.rejectedCount()} refused, needs a look.` : ''}
              </Text>
              <Button title="View sales waiting" variant="ghost" onPress={() => setView({ name: 'queue' })} />
            </View>
          ) : null}
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

function Sale({ staff, customer, offline, onDone, onQueued, onCancel }: {
  staff: StaffInfo; customer: CustomerInfo; offline?: boolean; onDone: (amount: number, r: EarnResult) => void;
  onQueued: (label: string, amount: number, estimate: number) => void; onCancel: () => void;
}) {
  const label = customer.name ?? (customer.phone ? formatFijiPhone(customer.phone) : `Customer …${customer.customer_id.slice(-4)}`);
  const [v, setV] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const txnId = useRef(newTxnId()).current;   // one id per sale, so a retry can never earn twice
  const amount = parseAmount(v);
  const preview = amount ? pointsFor(amount, staff.merchant.points_per_fjd) : null;
  return (
    <View style={s.form}>
      <Text style={s.title}>{label}</Text>
      <Text style={s.who}>{customer.balance === null ? 'Balance unknown while offline' : `${customer.balance} points now`}</Text>
      {offline ? <Text style={s.noticeText}>Offline: this sale will be saved on the phone and sent when the signal returns.</Text> : null}
      <View style={{ height: 20 }} />
      <Field label="Bill amount (FJD)" value={v} onChangeText={setV} keyboardType="decimal-pad" placeholder="0.00" autoFocus />
      {preview !== null ? <Text style={s.preview}>Customer earns {preview} points</Text> : null}
      <ErrorNote message={err} />
      <Button title="Confirm sale" loading={busy} disabled={!amount} onPress={async () => {
        if (!amount) return;
        setErr(null); setBusy(true);
        const occurredAt = new Date().toISOString();
        const r = await earn(customer.customer_id, amount, txnId, await getDeviceId());
        if (r.ok) { setBusy(false); onDone(amount, r.data); syncNow(); return; }
        if (!r.offline) { setBusy(false); setErr(r.message); return; }
        // No signal (or the reply was lost): keep the sale on the phone under the same id, so it can never be counted twice.
        if (saleQueue.recentFor(customer.customer_id) >= MAX_SCANS_PER_HOUR) {
          setBusy(false); setErr('This customer has already had several sales queued this hour.'); return;
        }
        const added = await saleQueue.add({ id: txnId, customerId: customer.customer_id, customerLabel: label, amount, occurredAt });
        setBusy(false);
        if (added === 'full') { setErr('Too many unsent sales on this phone. Get a signal and send them first.'); return; }
        onQueued(label, amount, pointsFor(amount, staff.merchant.points_per_fjd));
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
