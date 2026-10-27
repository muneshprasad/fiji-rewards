import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { serverEpochSeconds } from '../lib/clock';
import { customerQr } from '../lib/qr';
import { signQr } from '../lib/qrSign';
import { getQrSecret } from '../customer/qrSecret';
import { colors, fonts } from '../theme';
import QRCode from './QRCode';

const REFRESH_SECONDS = 20;

/** The customer's QR: signed with their secret and renewed every 20 seconds, so a screenshot is useless. */
export default function LiveQr({ userId, size = 240 }: { userId: string; size?: number }) {
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [ts, setTs] = useState(serverEpochSeconds());

  // Look up the secret; if that fails (no signal yet, or a temporary error) keep trying every 4 seconds.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getQrSecret(userId).then((v) => { if (alive) setSecret(v); });
    return () => { alive = false; };
  }, [userId, attempt]);
  useEffect(() => {
    if (secret !== null) return;
    const t = setInterval(() => setAttempt((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [secret]);
  useEffect(() => {
    const t = setInterval(() => setTs(serverEpochSeconds()), REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, []);

  if (secret === undefined) return <View style={{ height: size }} />;
  if (secret === null) {
    return <Text style={s.msg}>Connect to the internet once to set up your code. After that it works without a signal.</Text>;
  }
  return <QRCode value={customerQr(userId, ts, signQr(secret, userId, ts))} size={size} />;
}

const s = StyleSheet.create({ msg: { fontFamily: fonts.medium, color: colors.muted, textAlign: 'center', padding: 12 } });
