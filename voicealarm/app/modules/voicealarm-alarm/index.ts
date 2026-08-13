import { Platform } from 'react-native';

/**
 * VoicealarmAlarm 네이티브 모듈의 JS 표면.
 *
 * Android 전용 모듈이다(expo-module.config.json 의 platforms: ["android"]). iOS 번들에는
 * 이 네이티브 모듈이 아예 없으므로, import 시점에 무조건 requireNativeModule 을 부르면
 * iOS 에서 앱이 시작하자마자 죽는다. 그래서 Android 일 때만 실제로 로드하고, 그 외에는
 * "호출되면 에러" 스텁을 준다 — 호출부(androidAlarm.ts)가 Platform.OS 분기 뒤에서만
 * 쓰기로 돼 있지만, 방어적으로 한 겹 더 막아 둔다.
 */
export type ScheduleAlarmInput = {
  alarmId: string;
  /** epoch ms. */
  triggerAtMillis: number;
  /** file:// URI. 발화 시점에 재생할 로컬 오디오 파일. */
  audioFileUri: string;
  senderName: string;
  title: string;
};

export interface VoicealarmAlarmModule {
  scheduleAlarm(input: ScheduleAlarmInput): Promise<void>;
  cancelAlarm(alarmId: string): Promise<void>;
  isExactAlarmPermissionGranted(): Promise<boolean>;
  openExactAlarmSettings(): void;
  openBatteryOptimizationSettings(): void;
  /**
   * 알람 발화 직전 GET /alarms/:id/validity 호출에 쓸 자격 증명을 네이티브 쪽에도
   * 동기화해 둔다. 앱이 완전히 종료된 상태에서 알람이 울릴 때는 JS 가 아예 안 떠 있어서
   * (Android 는 이 경우 네이티브 AlarmReceiver 가 직접 서버를 호출한다), React 트리 밖의
   * 이 값에 의존한다. AuthContext 가 토큰을 저장/회전할 때마다 호출해야 한다.
   */
  setCredentials(input: { apiBaseUrl: string; accessToken: string; refreshToken: string }): void;
  clearCredentials(): void;
}

function unsupported(): never {
  throw new Error('VoicealarmAlarm 네이티브 모듈은 Android 에서만 지원됩니다.');
}

const stub: VoicealarmAlarmModule = {
  scheduleAlarm: async () => unsupported(),
  cancelAlarm: async () => unsupported(),
  isExactAlarmPermissionGranted: async () => unsupported(),
  openExactAlarmSettings: unsupported,
  openBatteryOptimizationSettings: unsupported,
  setCredentials: unsupported,
  clearCredentials: unsupported,
};

function load(): VoicealarmAlarmModule {
  if (Platform.OS !== 'android') return stub;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
  return requireNativeModule<VoicealarmAlarmModule>('VoicealarmAlarm');
}

export default load();
