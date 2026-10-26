import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from '../components/ui';
import { parseScan, Scan } from '../lib/qr';
import { colors, fonts } from '../theme';

export default function ScanScreen({ title, want, onScan, onTypeInstead, onCancel }: {
  title: string; want: Scan['kind']; onScan: (s: Scan) => void; onTypeInstead: () => void; onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return <View style={s.wrap} />;
  if (!permission.granted) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>Camera needed</Text>
        <Text style={s.sub}>Allow the camera to scan the customer's QR code, or type the number instead.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
        <Button title="Type instead" variant="ghost" onPress={onTypeInstead} />
        <Button title="Back" variant="ghost" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.deepTeal }}>
      <CameraView
        style={{ flex: 1 }} facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const scan = parseScan(data);
          if (scan && scan.kind === want) { handled.current = true; onScan(scan); }
        }}
      />
      <View style={s.bar}>
        <Text style={s.barTitle}>{title}</Text>
        <Button title="Type instead" onPress={onTypeInstead} />
        <Button title="Back" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  title: { fontFamily: fonts.extraBold, fontSize: 26, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted, marginVertical: 12 },
  bar: { backgroundColor: colors.background, padding: 16, paddingBottom: 28 },
  barTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, marginBottom: 8, textAlign: 'center' },
});
