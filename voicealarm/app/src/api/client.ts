/**
 * 서버 API 클라이언트.
 *
 * 설계 포인트
 * - fetch 와 토큰 저장소를 주입받는다. 그래야 RN 런타임 없이 테스트할 수 있고,
 *   Phase 4 에서 알람 발화 직전 유효성 확인을 백그라운드 태스크(=React 밖)에서
 *   호출할 때도 같은 클라이언트를 쓸 수 있다.
 * - access 토큰 만료(401)는 여기서 조용히 처리한다. 화면 코드가 401 을 알 필요는 없다.
 * - 동시에 여러 요청이 401 을 받아도 refresh 는 한 번만 실행한다(single-flight).
 *   안 그러면 회전된 토큰이 여러 개 생기고, 서버의 재사용 감지에 걸려 로그아웃된다.
 */

export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 네트워크 자체가 안 되는 경우. 화면에서 "다시 시도"를 띄우는 기준이 된다. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** 인증 헤더를 붙일지. 로그인/가입/refresh 만 false. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type ApiClientOptions = {
  baseUrl: string;
  store: TokenStore;
  fetchFn?: typeof fetch;
  /** refresh 까지 실패해서 세션이 끝났을 때 호출된다(로그인 화면으로 보내는 용도). */
  onSessionExpired?: () => void;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly fetchFn: typeof fetch;
  private readonly onSessionExpired?: () => void;
  private refreshInFlight: Promise<Tokens | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.store = options.store;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.onSessionExpired = options.onSessionExpired;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth ?? true;
    const response = await this.send(method, path, options, useAuth);

    // access 토큰이 죽었을 때만 재발급을 시도한다. 다른 401(계정 삭제 등)은 재시도해도 소용없다.
    if (response.status === 401 && useAuth && isRetriableAuthError(response.payload)) {
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        this.onSessionExpired?.();
        throw toApiError(response);
      }
      const retried = await this.send(method, path, options, true);
      if (!retried.ok) throw toApiError(retried);
      return retried.payload as T;
    }

    if (!response.ok) throw toApiError(response);
    return response.payload as T;
  }

  /** 로그인/가입 응답으로 받은 토큰을 저장한다. */
  async setTokens(tokens: Tokens): Promise<void> {
    await this.store.save(tokens);
  }

  async clearTokens(): Promise<void> {
    await this.store.clear();
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    useAuth: boolean,
  ): Promise<RawResponse> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    if (useAuth) {
      const tokens = await this.store.load();
      if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    }

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      // 네트워크 실패를 ApiError 로 통일한다. 화면마다 try/catch 종류를 나누지 않기 위해서다.
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        '네트워크에 연결할 수 없습니다.',
        error instanceof Error ? error.message : undefined,
      );
    }

    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: { code: 'MALFORMED_RESPONSE', message: text.slice(0, 200) } };
      }
    }

    return { ok: response.ok, status: response.status, payload };
  }

  /**
   * 토큰 재발급. 여러 요청이 동시에 401 을 받아도 실제 refresh 호출은 하나만 나간다.
   */
  private refreshTokens(): Promise<Tokens | null> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<Tokens | null> {
    const current = await this.store.load();
    if (!current) return null;

    const response = await this.send(
      'POST',
      '/auth/refresh',
      { body: { refresh_token: current.refreshToken } },
      false,
    );

    if (!response.ok) {
      await this.store.clear();
      return null;
    }

    const body = response.payload as { access_token: string; refresh_token: string };
    const next: Tokens = { accessToken: body.access_token, refreshToken: body.refresh_token };
    await this.store.save(next);
    return next;
  }
}

type RawResponse = { ok: boolean; status: number; payload: unknown };

/** access 토큰 만료로 인한 401 인지. 이 경우에만 refresh 후 재시도할 가치가 있다. */
function isRetriableAuthError(payload: unknown): boolean {
  const code = errorCodeOf(payload);
  return code === 'INVALID_TOKEN' || code === 'MISSING_TOKEN';
}

export function errorCodeOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { code?: unknown } }).error;
    if (error && typeof error.code === 'string') return error.code;
  }
  return null;
}

function toApiError(response: RawResponse): ApiError {
  const payload = response.payload as { error?: { code?: string; message?: string; details?: unknown } };
  return new ApiError(
    response.status,
    payload?.error?.code ?? 'UNKNOWN_ERROR',
    payload?.error?.message ?? '알 수 없는 오류가 발생했습니다.',
    payload?.error?.details,
  );
}
