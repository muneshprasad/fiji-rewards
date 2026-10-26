import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, fonts, MIN_TOUCH } from '../theme';

export function Button({ title, onPress, loading, disabled, variant = 'primary' }: {
  title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost';
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={[s.btn, variant === 'ghost' ? s.ghost : s.primary, off && { opacity: 0.5 }]}
    >
      {loading ? <ActivityIndicator color={variant === 'ghost' ? colors.teal : colors.white} /> : (
        <Text style={[s.btnText, variant === 'ghost' && { color: colors.teal }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[s.input, error ? { borderColor: colors.dangerText } : null]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <Text style={[s.error, { marginBottom: 12 }]}>{message}</Text> : null;
}

const s = StyleSheet.create({
  btn: { minHeight: MIN_TOUCH, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.teal },
  ghost: { backgroundColor: 'transparent' },
  btnText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  label: { fontFamily: fonts.medium, color: colors.ink, fontSize: 14, marginBottom: 6 },
  input: {
    minHeight: MIN_TOUCH, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white,
    paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 18, color: colors.ink,
  },
  error: { color: colors.dangerText, fontFamily: fonts.medium, fontSize: 14, marginTop: 6 },
});
