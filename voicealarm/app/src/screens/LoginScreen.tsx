import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorBanner, Heading, Screen, TextField } from '../components';
import { useI18n } from '../i18n/context';
import { useTheme } from '../theme';

export function LoginScreen({ onGoToSignup }: { onGoToSignup: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { login } = useAuth();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = userId.trim().length >= 3 && password.length >= 1 && !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await login(userId.trim(), password);
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', minHeight: 480 }}>
          <Heading>{t('auth.login.title')}</Heading>

          <ErrorBanner error={error} />

          <TextField
            label={t('auth.field.userId')}
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
          />

          <TextField
            label={t('auth.field.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => canSubmit && void handleSubmit()}
          />

          <Button
            label={t('auth.login.submit')}
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={submitting}
          />

          <Pressable onPress={onGoToSignup} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
              {t('auth.login.toSignup')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
