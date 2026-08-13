import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { I18nProvider } from './src/i18n/context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { addForegroundNotificationResponseListener, registerBackgroundNotificationTask } from './src/push/backgroundTask';
import { setupNotifications } from './src/push/setup';
import { usePushRegistration } from './src/push/usePushRegistration';
import { ThemeProvider } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <StatusBar style="auto" />
            <PushSetup />
            <RootNavigator />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * 알람 푸시 관련 전역 설정을 한 곳에 모은다. 로그인 여부와 무관한 설정(알림 카테고리,
 * 응답 리스너)은 앱 시작 시 한 번, 토큰 등록은 로그인된 뒤에만 실행한다.
 */
function PushSetup() {
  const { state, client } = useAuth();

  useEffect(() => {
    void setupNotifications();
    void registerBackgroundNotificationTask();
    const subscription = addForegroundNotificationResponseListener();
    return () => subscription.remove();
  }, []);

  usePushRegistration(client, state.status === 'signedIn');

  return null;
}
