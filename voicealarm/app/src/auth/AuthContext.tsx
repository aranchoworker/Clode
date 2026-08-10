import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { PublicUser } from '../api/types';
import { API_BASE_URL } from '../config';
import { SecureTokenStore } from './storage';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: PublicUser };

type AuthValue = {
  state: AuthState;
  client: ApiClient;
  login: (userId: string, password: string) => Promise<void>;
  signup: (userId: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const storeRef = useRef(new SecureTokenStore());

  // 클라이언트는 앱 생애주기 동안 하나만 유지한다.
  // 매 렌더마다 새로 만들면 single-flight refresh 가 무의미해진다.
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_BASE_URL,
        store: storeRef.current,
        onSessionExpired: () => setState({ status: 'signedOut' }),
      }),
    [],
  );

  // 앱 시작 시 저장된 토큰으로 세션을 복원한다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const tokens = await storeRef.current.load();
      if (!tokens) {
        if (!cancelled) setState({ status: 'signedOut' });
        return;
      }

      try {
        const { user } = await api.auth.me(client);
        if (!cancelled) setState({ status: 'signedIn', user });
      } catch (error) {
        // 네트워크가 안 되는 것뿐이라면 토큰을 지우면 안 된다.
        // 비행기 모드에서 앱을 열었다고 로그아웃시키는 건 과하다.
        if (error instanceof ApiError && error.isNetworkError) {
          if (!cancelled) setState({ status: 'signedOut' });
          return;
        }
        await storeRef.current.clear();
        if (!cancelled) setState({ status: 'signedOut' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const login = useCallback(
    async (userId: string, password: string) => {
      const session = await api.auth.login(client, { userId, password });
      await client.setTokens({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      });
      setState({ status: 'signedIn', user: session.user });
    },
    [client],
  );

  const signup = useCallback(
    async (userId: string, password: string, displayName: string) => {
      const session = await api.auth.signup(client, { userId, password, displayName });
      await client.setTokens({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      });
      setState({ status: 'signedIn', user: session.user });
    },
    [client],
  );

  const logout = useCallback(async () => {
    const tokens = await storeRef.current.load();
    if (tokens) {
      // 서버 폐기가 실패해도 로컬 세션은 반드시 끝낸다.
      // 여기서 예외가 새어 나가면 사용자가 로그아웃을 못 하는 상태에 갇힌다.
      await api.auth.logout(client, tokens.refreshToken).catch(() => undefined);
    }
    await client.clearTokens();
    setState({ status: 'signedOut' });
  }, [client]);

  const value = useMemo<AuthValue>(
    () => ({ state, client, login, signup, logout }),
    [state, client, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** 로그인된 상태에서만 쓰는 훅. 화면마다 status 분기를 반복하지 않게 한다. */
export function useSession(): { user: PublicUser; client: ApiClient } {
  const { state, client } = useAuth();
  if (state.status !== 'signedIn') {
    throw new Error('useSession requires an authenticated session');
  }
  return { user: state.user, client };
}
