import * as SecureStore from 'expo-secure-store';
import type { TokenStore, Tokens } from '../api/client';
import { clearAndroidCredentials, syncAndroidCredentials } from '../alarms/androidAlarm';
import { API_BASE_URL } from '../config';

const ACCESS_KEY = 'voicealarm.access_token';
const REFRESH_KEY = 'voicealarm.refresh_token';

/**
 * 토큰은 SecureStore(iOS Keychain / Android EncryptedSharedPreferences)에 넣는다.
 * AsyncStorage 는 평문 파일이라 루팅/탈옥 기기에서 그대로 읽힌다.
 *
 * 메모리 캐시를 두는 이유: 모든 API 호출마다 Keychain 을 때리면 느리고,
 * Phase 4 의 알람 발화 경로는 지연에 특히 민감하다.
 *
 * save()/clear() 가 호출될 때마다 Android 네이티브 모듈에도 같은 토큰을 복사한다.
 * ApiClient 의 자동 재발급(doRefresh)이 AuthContext 를 거치지 않고 여기 직접
 * save() 를 부르기 때문에, "토큰이 바뀌는 모든 지점"을 놓치지 않으려면 이 클래스
 * 안에서 동기화하는 게 유일하게 안전한 지점이다.
 */
export class SecureTokenStore implements TokenStore {
  private cache: Tokens | null | undefined;

  async load(): Promise<Tokens | null> {
    if (this.cache !== undefined) return this.cache;

    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);

    this.cache = accessToken && refreshToken ? { accessToken, refreshToken } : null;
    return this.cache;
  }

  async save(tokens: Tokens): Promise<void> {
    this.cache = tokens;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
    ]);
    syncAndroidCredentials(API_BASE_URL, tokens.accessToken, tokens.refreshToken);
  }

  async clear(): Promise<void> {
    this.cache = null;
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
    clearAndroidCredentials();
  }
}
