import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNote, Field } from '../components/ui';
import { normalizeFijiPhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';

export default function PhoneScreen({ onSent }: { onSent: (phone: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    const phone = normalizeFijiPhone(value);
    if (!phone) { setError('Enter a Fiji mobile number, for example 700 1234.'); return; }
    setError(null); setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (err) { setError('We could not send the code. Check your number and try again.'); return; }
    onSent(phone);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <Image source={require('../../assets/icon.png')} style={s.logo} accessibilityLabel="Fiji Rewards logo" />
      <Text style={s.title}>Fiji Rewards</Text>
      <Text style={s.sub}>One wallet. Every local shop. Sign in with your phone number.</Text>
      <View style={{ marginTop: 28 }}>
        <Field label="Mobile number" value={value} onChangeText={setValue} keyboardType="phone-pad"
          placeholder="+679 700 1234" autoComplete="tel" textContentType="telephoneNumber" />
        <ErrorNote message={error} />
        <Button title="Send code" onPress={send} loading={loading} />
        <Text style={s.fine}>We will text you a 6-digit code. Standard SMS rates may apply.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  logo: { width: 84, height: 84, borderRadius: 20, marginBottom: 16 },
  title: { fontFamily: fonts.extraBold, fontSize: 32, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted, marginTop: 6 },
  fine: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 14, textAlign: 'center' },
});
