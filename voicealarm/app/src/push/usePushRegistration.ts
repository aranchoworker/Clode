import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { registerDeviceForPush } from './registerDevice';

/**
 * 로그인된 상태에서 한 번 실행해서 푸시 토큰을 서버에 등록한다.
 *
 * ⚠️ iOS 에서는 이 토큰이 raw APNs 토큰이라, 서버가 firebase-admin 으로 그대로
 * 발송을 시도하면 실패한다(README 의 "Phase 4 에서 아직 없는 것" 참고). Android 는
 * 이 토큰이 실제 FCM 등록 토큰이라 그대로 동작한다. 지금은 두 플랫폼 다 같은 코드로
 * 등록하고, iOS FCM 브리징은 이후 과제로 남겨 둔다 — Android 를 먼저 검증하기로 한
 * 원래 계획과도 맞다.
 */
export function usePushRegistration(client: ApiClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void registerDeviceForPush(client, {
      requestPermission: async () => {
        const existing = await Notifications.getPermissionsAsync();
        if (existing.granted) return true;
        const requested = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        return requested.granted;
      },
      getDeviceToken: async () => {
        const token = await Notifications.getDevicePushTokenAsync();
        // getDevicePushTokenAsync 의 타입은 web 도 포함하지만, RN 런타임에서는
        // 항상 'ios' | 'android' 다(config.ts 도 이 두 플랫폼만 지원).
        return { token: String(token.data), platform: Platform.OS as 'ios' | 'android' };
      },
    }).then((result) => {
      if (cancelled) return;
      if (result.status === 'error') {
        // 조용히 실패한다. 알람 기능 자체가 아직 미완성 단계라, 사용자에게 에러를
        // 보여줘 봐야 할 수 있는 게 없다. 콘솔에는 남긴다(개발 중 디버깅용).
        console.warn('푸시 토큰 등록 실패', result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, enabled]);
}
