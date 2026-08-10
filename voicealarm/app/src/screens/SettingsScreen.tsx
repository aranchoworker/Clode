import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth, useSession } from '../auth/AuthContext';
import { Button, Heading, Muted, Screen } from '../components';
import { useI18n } from '../i18n/context';
import { useTheme } from '../theme';

export function SettingsScreen({ onOpenBlocks }: { onOpenBlocks: () => void }) {
  const { t } = useI18n();
  const { colors, radius, spacing } = useTheme();
  const { user } = useSession();
  const { logout } = useAuth();

  function confirmLogout() {
    Alert.alert(t('settings.logout'), t('settings.logout.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.logout'), style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <Screen scroll>
      <Heading>{t('settings.title')}</Heading>

      <Section title={t('settings.account')}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
          {user.display_name}
        </Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>@{user.user_id}</Text>
      </Section>

      <Pressable
        onPress={onOpenBlocks}
        style={({ pressed }) => ({
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.lg,
          marginBottom: spacing.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
          {t('settings.blocks')}
        </Text>
      </Pressable>

      <Section title={t('settings.permissions')}>
        <Muted>{t('settings.permissions.pending')}</Muted>
      </Section>

      <View style={{ marginTop: spacing.lg }}>
        <Button label={t('settings.logout')} variant="danger" onPress={confirmLogout} />
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '700',
          color: colors.textMuted,
          textTransform: 'uppercase',
          marginBottom: spacing.sm,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        {children}
      </View>
    </View>
  );
}
