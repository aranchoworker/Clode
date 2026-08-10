import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/context';
import { describeError } from '../lib/errorMessage';
import { useTheme } from '../theme';

/** 화면 공통 껍데기. 배경색과 안전영역을 한 곳에서 처리한다. */
export function Screen({
  children,
  scroll = false,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const style = { flex: 1, backgroundColor: colors.background };
  const contentStyle = padded ? { padding: spacing.lg } : undefined;

  if (scroll) {
    return (
      <SafeAreaView style={style} edges={['top']}>
        <ScrollView
          contentContainerStyle={[{ flexGrow: 1 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={style} edges={['top']}>
      <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const { colors, spacing } = useTheme();
  return (
    <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: spacing.lg }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19 }}>{children}</Text>;
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const { colors, radius, spacing } = useTheme();

  const background = {
    primary: colors.primary,
    secondary: colors.surfaceAlt,
    danger: colors.dangerSurface,
    ghost: 'transparent',
  }[variant];

  const textColor = {
    primary: colors.primaryText,
    secondary: colors.text,
    danger: colors.danger,
    ghost: colors.primary,
  }[variant];

  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => ({
        backgroundColor: background,
        borderRadius: radius.md,
        paddingVertical: compact ? spacing.sm : spacing.md + 2,
        paddingHorizontal: compact ? spacing.md : spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1,
        borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth,
        borderColor: variant === 'secondary' ? colors.border : 'transparent',
      })}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={{ color: textColor, fontWeight: '600', fontSize: compact ? 13 : 15 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  hint,
  ...inputProps
}: TextInputProps & { label: string; hint?: string }) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text
        style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...inputProps}
        style={{
          backgroundColor: colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          fontSize: 16,
          color: colors.text,
        }}
      />
      {hint ? (
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: spacing.xs }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** API 에러를 그대로 받아서 화면 언어로 렌더한다. */
export function ErrorBanner({ error }: { error: unknown }) {
  const { colors, radius, spacing } = useTheme();
  const { t } = useI18n();

  if (!error) return null;
  const described = describeError(error);
  const message = 'key' in described ? t(described.key) : described.text;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: colors.dangerSurface,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <Text style={{ color: colors.danger, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
      <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>{message}</Text>
    </View>
  );
}

export function Loading() {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  const { colors, radius } = useTheme();
  if (count <= 0) return null;

  return (
    <View
      style={{
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: radius.pill,
        backgroundColor: colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

/** 친구/요청/차단 목록에서 공통으로 쓰는 한 줄. */
export function UserRow({
  displayName,
  userId,
  actions,
}: {
  displayName: string;
  userId: string;
  actions?: ReactNode;
}) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.sm,
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{displayName}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>@{userId}</Text>
      </View>
      {actions ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>{actions}</View>
      ) : null}
    </View>
  );
}

/** 화면 안에서 목록을 전환하는 세그먼트 탭. */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        padding: 3,
        marginBottom: spacing.lg,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              flexDirection: 'row',
              gap: 6,
              paddingVertical: spacing.sm,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? colors.background : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: active ? '700' : '500',
                color: active ? colors.text : colors.textMuted,
              }}
            >
              {option.label}
            </Text>
            <Badge count={option.badge ?? 0} />
          </Pressable>
        );
      })}
    </View>
  );
}
