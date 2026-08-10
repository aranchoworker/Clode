import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorBanner, Heading, Screen, TextField } from '../components';
import { useI18n } from '../i18n/context';
import { useTheme } from '../theme';

/** 서버 검증 규칙과 동일하게 맞춘다. 서버가 최종 판단이고, 여기는 왕복을 줄이는 용도다. */
const USER_ID_PATTERN = /^[a-zA-Z0-9._-]{3,20}$/;

export function SignupScreen({ onGoToLogin }: { onGoToLogin: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { signup } = useAuth();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    USER_ID_PATTERN.test(userId.trim()) &&
    password.length >= 8 &&
    displayName.trim().length >= 1 &&
    !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await signup(userId.trim(), password, displayName.trim());
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', minHeight: 560 }}>
          <Heading>{t('auth.signup.title')}</Heading>

          <ErrorBanner error={error} />

          <TextField
            label={t('auth.field.userId')}
            hint={t('auth.field.userId.hint')}
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
          />

          <TextField
            label={t('auth.field.password')}
            hint={t('auth.field.password.hint')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />

          <TextField
            label={t('auth.field.displayName')}
            hint={t('auth.field.displayName.hint')}
            value={displayName}
            onChangeText={setDisplayName}
            autoCorrect={false}
          />

          <Button
            label={t('auth.signup.submit')}
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={submitting}
          />

          <Pressable onPress={onGoToLogin} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
              {t('auth.signup.toLogin')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
