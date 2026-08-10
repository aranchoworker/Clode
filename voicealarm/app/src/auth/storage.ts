import * as SecureStore from 'expo-secure-store';
import type { TokenStore, Tokens } from '../api/client';

const ACCESS_KEY = 'voicealarm.access_token';
const REFRESH_KEY = 'voicealarm.refresh_token';

/**
 * 토큰은 SecureStore(iOS Keychain / Android EncryptedSharedPreferences)에 넣는다.
 * AsyncStorage 는 평문 파일이라 루팅/탈옥 기기에서 그대로 읽힌다.
 *
 * 메모리 캐시를 두는 이유: 모든 API 호출마다 Keychain 을 때리면 느리고,
 * Phase 4 의 알람 발화 경로는 지연에 특히 민감하다.
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
  }

  async clear(): Promise<void> {
    this.cache = null;
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  }
}
