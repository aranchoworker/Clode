import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API 주소.
 *
 * 개발 중 기본값이 플랫폼마다 다른 이유:
 * - Android 에뮬레이터에서 호스트 PC 는 10.0.2.2 다 (localhost 는 에뮬레이터 자신).
 * - iOS 시뮬레이터는 호스트와 네트워크를 공유하므로 localhost 로 닿는다.
 *
 * 실기기로 테스트할 때는 app.json 의 extra.apiBaseUrl 을 PC 의 LAN IP 로 바꾼다.
 * (실기기는 개발 PC 의 localhost 에 닿을 수 없다 — 실제로 자주 막히는 지점이다.)
 */
const devFallback = Platform.select({
  android: 'http://10.0.2.2:3000',
  default: 'http://localhost:3000',
});

const configured = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

export const API_BASE_URL = configured && configured.length > 0 ? configured : devFallback;
