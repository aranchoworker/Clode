import { Platform } from 'react-native';
import type { Alarm } from '../api/types';
import VoicealarmAlarm from '../../modules/voicealarm-alarm';

/**
 * Android 로컬 알람 스케줄링.
 *
 * 여기는 JS 로 할 수 있는 게 없다 — expo-notifications 의 로컬 알림 스케줄러는 일반
 * 알림용이라 Doze 우회, 풀스크린 인텐트, STREAM_ALARM 재생을 지원하지 않는다.
 * 실제 "알람 시계" 동작은 AlarmManager.setAlarmClock() + 풀스크린 액티비티 +
 * Foreground Service 조합이 필요해서, modules/voicealarm-alarm 에 네이티브 Kotlin 모듈로
 * 만들었다. 이 파일은 그 모듈을 부르는 얇은 래퍼일 뿐이다.
 *
 * ⚠️ 네이티브 모듈 자체가 컴파일/실기기 검증이 안 된 상태다. modules/voicealarm-alarm/README.md
 * 참고.
 */
export async function scheduleAndroidAlarm(alarm: Alarm, localAudioUri: string): Promise<void> {
  await VoicealarmAlarm.scheduleAlarm({
    alarmId: alarm.id,
    triggerAtMillis: new Date(alarm.scheduled_at).getTime(),
    audioFileUri: localAudioUri,
    senderName: alarm.sender.display_name,
    title: alarm.title ?? '',
  });
}

export async function cancelAndroidAlarm(alarmId: string): Promise<void> {
  await VoicealarmAlarm.cancelAlarm(alarmId);
}

export async function isExactAlarmPermissionGranted(): Promise<boolean> {
  return VoicealarmAlarm.isExactAlarmPermissionGranted();
}

/** 사용자를 "정확한 알람" 시스템 설정 화면으로 보낸다(Android 12+, 앱 내 권한 요청 다이얼로그가 없음). */
export function openExactAlarmSettings(): void {
  VoicealarmAlarm.openExactAlarmSettings();
}

export function openBatteryOptimizationSettings(): void {
  VoicealarmAlarm.openBatteryOptimizationSettings();
}

/**
 * JS 가 갖고 있는 토큰을 네이티브 쪽에도 복사해 둔다.
 *
 * 앱이 완전히 종료된 상태에서 AlarmManager 가 발화하면 JS/React Native 엔진이 아예
 * 안 뜬 채로 네이티브 코드(AlarmReceiver)만 실행된다. 그 시점에 발화 직전 재검증
 * (GET /alarms/:id/validity) 을 서버에 물어보려면 네이티브 코드가 자기 토큰을 갖고
 * 있어야 한다 — AuthContext 의 인메모리 상태에 접근할 방법이 없기 때문이다.
 */
export function syncAndroidCredentials(
  apiBaseUrl: string,
  accessToken: string,
  refreshToken: string,
): void {
  if (Platform.OS !== 'android') return;
  VoicealarmAlarm.setCredentials({ apiBaseUrl, accessToken, refreshToken });
}

export function clearAndroidCredentials(): void {
  if (Platform.OS !== 'android') return;
  VoicealarmAlarm.clearCredentials();
}
