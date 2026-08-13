import { ApiClient } from '../api/client';
import { SecureTokenStore } from '../auth/storage';
import { API_BASE_URL } from '../config';

/**
 * 백그라운드 태스크(TaskManager)는 React 트리 밖에서 실행되므로 AuthContext 의
 * ApiClient 를 쓸 수 없다. 그래서 client.ts 를 순수 클래스로 설계해 뒀다 — 여기서
 * 독립적으로 하나 더 만든다. 토큰은 SecureStore 에서 그대로 읽으므로 로그인 세션과
 * 항상 같은 자격으로 동작한다.
 */
let instance: ApiClient | null = null;

export function getBackgroundClient(): ApiClient {
  instance ??= new ApiClient({ baseUrl: API_BASE_URL, store: new SecureTokenStore() });
  return instance;
}
