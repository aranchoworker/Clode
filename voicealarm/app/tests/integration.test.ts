import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/api/client';
import { api } from '../src/api/endpoints';
import { MemoryTokenStore } from '../src/auth/memoryStore';

/**
 * 앱의 엔드포인트 래퍼를 실제로 돌아가는 서버에 붙여서 확인한다.
 *
 * 목(mock) 테스트만으로는 경로 오타나 snake_case 필드 불일치를 못 잡는다.
 * 그런 건 기기에 올려서야 발견되는데, 그때는 원인을 찾는 데 훨씬 오래 걸린다.
 *
 * 실행:
 *   (터미널 1) cd ../server && npm run dev
 *   (터미널 2) VOICEALARM_API_URL=http://localhost:3000 npm test
 *
 * 서버 주소가 없으면 조용히 건너뛴다(기본 `npm test` 는 서버 없이 돌아야 하므로).
 */
const BASE_URL = process.env.VOICEALARM_API_URL;

describe.skipIf(!BASE_URL)('실제 서버 연동', () => {
  const unique = () => `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function makeClient() {
    return new ApiClient({ baseUrl: BASE_URL!, store: new MemoryTokenStore() });
  }

  async function signUp(client: ApiClient) {
    const userId = unique();
    const session = await api.auth.signup(client, {
      userId,
      password: 'password123',
      displayName: userId,
    });
    await client.setTokens({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
    return session;
  }

  beforeAll(async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.ok, `서버(${BASE_URL})에 연결할 수 없습니다`).toBe(true);
  });

  it('가입 → 검색 → 친구 요청 → 수락 → 목록까지 앱 코드로 관통한다', async () => {
    const alice = makeClient();
    const bob = makeClient();

    const aliceSession = await signUp(alice);
    const bobSession = await signUp(bob);

    // 정확 일치 검색
    const found = await api.users.search(alice, bobSession.user.user_id);
    expect(found.user.id).toBe(bobSession.user.id);
    expect(found.relation).toBeNull();

    // 요청 → 받은 요청 목록에 나타남
    await api.friends.sendRequest(alice, bobSession.user.user_id);
    const incoming = await api.friends.requests(bob, 'incoming');
    const request = incoming.requests.find((r) => r.user.id === aliceSession.user.id);
    expect(request).toBeDefined();
    expect(request!.direction).toBe('incoming');

    // 수락 전에는 친구 목록이 비어 있다
    expect((await api.friends.list(bob)).friends).toHaveLength(0);

    await api.friends.accept(bob, request!.id);

    const friends = await api.friends.list(alice);
    expect(friends.friends.map((f) => f.id)).toContain(bobSession.user.id);
  });

  it('차단하면 상대에게 존재하지 않는 것처럼 보인다', async () => {
    const alice = makeClient();
    const bob = makeClient();
    const aliceSession = await signUp(alice);
    const bobSession = await signUp(bob);

    await api.blocks.create(bob, aliceSession.user.user_id);

    await expect(api.users.search(alice, bobSession.user.user_id)).rejects.toMatchObject({
      status: 404,
      code: 'USER_NOT_FOUND',
    });

    const blocks = await api.blocks.list(bob);
    expect(blocks.blocks.map((b) => b.user.id)).toContain(aliceSession.user.id);
  });

  it('access 토큰이 죽어도 클라이언트가 알아서 재발급받는다', async () => {
    const alice = makeClient();
    const session = await signUp(alice);

    // access 토큰만 망가뜨린다. refresh 는 살아 있으므로 조용히 복구돼야 한다.
    await alice.setTokens({
      accessToken: 'obviously.invalid.token',
      refreshToken: session.refresh_token,
    });

    const me = await api.auth.me(alice);
    expect(me.user.id).toBe(session.user.id);
  });
});
