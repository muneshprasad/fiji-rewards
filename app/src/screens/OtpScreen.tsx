import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { formatFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';

const RESEND_SECONDS = 60;

export default function OtpScreen({ phone, onBack }: { phone: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify() {
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from the SMS.'); return; }
    setError(null); setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    setLoading(false);
    if (err) setError('That code did not work. Check it and try again.' + (__DEV__ ? `\n\n[test info] ${err.message}` : ''));
    // On success the auth listener in App moves to the profile.
  }

  async function resend() {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ phone });
    if (err) setError('We could not send a new code. Try again shortly.'); else setWait(RESEND_SECONDS);
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Enter your code</Text>
      <Text style={s.sub}>We sent a 6-digit code to {formatFijiPhone(phone)}.</Text>
      <View style={{ marginTop: 24 }}>
        <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} />
        <ErrorNote message={error} />
        <Button title="Sign in" onPress={verify} loading={loading} />
        <Button title={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'} variant="ghost" onPress={resend} disabled={wait > 0} />
        <Button title="Use a different number" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  title: { fontFamily: fonts.extraBold, fontSize: 28, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted, marginTop: 6 },
});
