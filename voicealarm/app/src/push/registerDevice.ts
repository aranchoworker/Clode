import type { ApiClient } from '../api/client';
import { api } from '../api/endpoints';

export type PushRegistrationDeps = {
  requestPermission: () => Promise<boolean>;
  /**
   * 기기의 "네이티브" 푸시 토큰.
   *
   * Expo 의 추상화된 ExpoPushToken 이 아니라 OS 원본 토큰을 쓴다 — 서버가
   * firebase-admin 으로 FCM 에 직접 발송하기 때문에(Expo 푸시 서버를 거치지 않음),
   * FCM 이 이해하는 토큰이어야 한다.
   *
   * Android 에서는 이게 실제 FCM 등록 토큰이라 그대로 동작한다.
   * iOS 에서는 이게 raw APNs 토큰이라 firebase-admin 에 그대로 넣으면 실패한다 —
   * Firebase iOS SDK 가 내부적으로 하는 "APNs 토큰 → FCM 토큰" 교환이 빠져 있기 때문이다.
   * README 의 "Phase 4 에서 아직 없는 것"에 이 문제를 기록해 뒀다.
   */
  getDeviceToken: () => Promise<{ token: string; platform: 'ios' | 'android' }>;
};

export type PushRegistrationResult =
  | { status: 'registered'; deviceId: string }
  | { status: 'permission_denied' }
  | { status: 'error'; error: unknown };

/**
 * 순수 로직만 담는다. expo-notifications 호출은 deps 로 주입받아서,
 * RN 런타임 없이도(테스트에서) 등록 순서와 에러 처리를 검증할 수 있게 한다.
 */
export async function registerDeviceForPush(
  client: ApiClient,
  deps: PushRegistrationDeps,
): Promise<PushRegistrationResult> {
  const granted = await deps.requestPermission();
  if (!granted) {
    return { status: 'permission_denied' };
  }

  try {
    const { token, platform } = await deps.getDeviceToken();
    const result = await api.devices.register(client, { platform, pushToken: token });
    return { status: 'registered', deviceId: result.device.id };
  } catch (error) {
    return { status: 'error', error };
  }
}
