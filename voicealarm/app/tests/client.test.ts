import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, type TokenStore, type Tokens } from '../src/api/client';

/**
 * API 클라이언트는 RN 런타임 없이 순수하게 돌아가도록 만들었기 때문에
 * fetch 와 토큰 저장소만 갈아끼우면 그대로 테스트할 수 있다.
 * 여기서 검증하는 건 화면 코드가 절대 다루지 않아야 할 부분 — 토큰 재발급이다.
 */
class MemoryStore implements TokenStore {
  constructor(public tokens: Tokens | null = null) {}
  async load() {
    return this.tokens;
  }
  async save(tokens: Tokens) {
    this.tokens = tokens;
  }
  async clear() {
    this.tokens = null;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Response 의 body 는 한 번만 읽을 수 있으므로 매번 새로 만든다.
const expiredToken = () =>
  jsonResponse(401, {
    error: { code: 'INVALID_TOKEN', message: '토큰이 유효하지 않거나 만료되었습니다.' },
  });

describe('ApiClient', () => {
  it('저장된 access 토큰을 Authorization 헤더에 붙인다', async () => {
    const store = new MemoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchFn = vi.fn(async () => jsonResponse(200, { friends: [] }));

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });
    await client.get('/friends');

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer a1');
  });

  it('query 파라미터를 URL 에 붙인다', async () => {
    const store = new MemoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });
    await client.get('/users/search', { query: { user_id: 'bob' } });

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://api.test/users/search?user_id=bob');
  });

  it('401(INVALID_TOKEN)이면 재발급 후 원래 요청을 한 번 재시도한다', async () => {
    const store = new MemoryStore({ accessToken: 'stale', refreshToken: 'r1' });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(expiredToken())
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' }))
      .mockResolvedValueOnce(jsonResponse(200, { friends: [{ id: 'u1' }] }));

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });
    const result = await client.get<{ friends: unknown[] }>('/friends');

    expect(result.friends).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    // 회전된 새 토큰이 저장돼야 다음 요청부터 바로 쓰인다
    expect(store.tokens).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('동시에 여러 요청이 401 을 받아도 refresh 는 한 번만 나간다', async () => {
    // 서버는 회전된 refresh 토큰의 재사용을 탈취로 간주하므로,
    // 동시 재발급이 새어 나가면 사용자가 통째로 로그아웃된다. 이 테스트가 그걸 막는다.
    const store = new MemoryStore({ accessToken: 'stale', refreshToken: 'r1' });
    let refreshCalls = 0;

    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(200, { access_token: 'a2', refresh_token: 'r2' });
      }
      const tokens = store.tokens;
      if (tokens?.accessToken === 'stale') return expiredToken();
      return jsonResponse(200, { ok: true });
    });

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });
    await Promise.all([client.get('/friends'), client.get('/blocks'), client.get('/auth/me')]);

    expect(refreshCalls).toBe(1);
  });

  it('refresh 도 실패하면 토큰을 지우고 세션 만료를 알린다', async () => {
    const store = new MemoryStore({ accessToken: 'stale', refreshToken: 'r1' });
    const onSessionExpired = vi.fn();

    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? jsonResponse(401, { error: { code: 'REFRESH_TOKEN_REUSED', message: '재로그인 필요' } })
        : expiredToken(),
    );

    const client = new ApiClient({
      baseUrl: 'http://api.test',
      store,
      fetchFn: fetchFn as never,
      onSessionExpired,
    });

    await expect(client.get('/friends')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(store.tokens).toBeNull();
  });

  it('access 토큰 만료가 아닌 401 은 재발급을 시도하지 않는다', async () => {
    const store = new MemoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchFn = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'ACCOUNT_UNAVAILABLE', message: '사용할 수 없는 계정' } }),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });

    await expect(client.get('/friends')).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('서버 에러 코드를 ApiError 로 옮긴다', async () => {
    const store = new MemoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchFn = vi.fn(async () =>
      jsonResponse(403, { error: { code: 'NOT_FRIENDS', message: '친구가 아닙니다.' } }),
    );

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });

    await expect(client.post('/alarms')).rejects.toMatchObject({
      status: 403,
      code: 'NOT_FRIENDS',
    });
  });

  it('네트워크 실패도 ApiError 로 통일한다', async () => {
    const store = new MemoryStore(null);
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });

    try {
      await client.get('/friends');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).isNetworkError).toBe(true);
    }
  });

  it('로그인·가입 요청에는 Authorization 헤더를 붙이지 않는다', async () => {
    const store = new MemoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));

    const client = new ApiClient({ baseUrl: 'http://api.test', store, fetchFn: fetchFn as never });
    await client.post('/auth/login', { auth: false, body: { user_id: 'a', password: 'b' } });

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});
