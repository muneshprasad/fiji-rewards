import React, { useMemo } from 'react';
import { View } from 'react-native';
import { qrMatrix } from '../lib/qrMatrix';

/** Draws a QR code with plain Views: dark modules on a white card with a quiet zone. */
export default function QRCode({ value, size = 220 }: { value: string; size?: number }) {
  const grid = useMemo(() => qrMatrix(value), [value]);
  const quiet = 2;
  const cell = Math.floor(size / (grid.length + quiet * 2));
  const side = cell * (grid.length + quiet * 2);
  return (
    <View accessible accessibilityLabel="QR code" style={{ width: side, height: side, backgroundColor: '#fff', padding: cell * quiet }}>
      {grid.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((on, c) => <View key={c} style={{ width: cell, height: cell, backgroundColor: on ? '#0D2B2E' : '#fff' }} />)}
        </View>
      ))}
    </View>
  );
}
