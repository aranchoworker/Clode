import * as Notifications from 'expo-notifications';
import { registerAlarmNotificationCategory } from '../alarms/iosAlarm';

/**
 * 앱 시작 시 한 번 호출하는 전역 설정. 로그인 여부와 무관하다 —
 * 로그인 전에도 이미 예약된 로컬 알림(iOS)이 울릴 수 있어야 한다.
 */
export async function setupNotifications(): Promise<void> {
  // 알림이 도착했을 때 앱이 포그라운드에 떠 있어도 그대로 배너/사운드를 보여준다.
  // 알람 앱에서 "앱을 보고 있을 때만 조용히 무시"되면 안 된다.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await registerAlarmNotificationCategory();
}
