import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  auth,
  becomeFriends,
  createTestApp,
  prisma,
  resetDb,
  sendFriendRequest,
  signUp,
  type TestUser,
} from './helpers.js';

describe('친구 요청/수락', () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    alice = await signUp(app, 'alice');
    bob = await signUp(app, 'bob');
  });

  it('아이디 정확 일치로만 검색된다', async () => {
    const exact = await app.inject({
      method: 'GET',
      url: '/users/search?user_id=bob',
      headers: auth(alice),
    });
    expect(exact.statusCode).toBe(200);
    expect(exact.json().user.user_id).toBe('bob');

    // 부분 일치(접두어)는 검색되지 않아야 한다 — 아이디 훑기 방지
    const carol = await signUp(app, 'carolyn');
    void carol;

    const partial = await app.inject({
      method: 'GET',
      url: '/users/search?user_id=carol',
      headers: auth(alice),
    });
    expect(partial.statusCode).toBe(404);
  });

  it('요청 → 수락 흐름에서 양쪽 친구 목록에 서로가 보인다', async () => {
    const requestId = await sendFriendRequest(app, alice, bob);

    const incoming = await app.inject({
      method: 'GET',
      url: '/friends/requests?direction=incoming',
      headers: auth(bob),
    });
    expect(incoming.json().requests).toHaveLength(1);
    expect(incoming.json().requests[0].user.user_id).toBe('alice');

    // 수락 전에는 친구 목록이 비어 있다
    const beforeAccept = await app.inject({ method: 'GET', url: '/friends', headers: auth(bob) });
    expect(beforeAccept.json().friends).toHaveLength(0);

    const accept = await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/accept`,
      headers: auth(bob),
    });
    expect(accept.statusCode).toBe(200);

    for (const [user, expected] of [
      [alice, 'bob'],
      [bob, 'alice'],
    ] as const) {
      const list = await app.inject({ method: 'GET', url: '/friends', headers: auth(user) });
      expect(list.json().friends.map((f: { user_id: string }) => f.user_id)).toEqual([expected]);
    }
  });

  it('수신자가 아닌 사람은 요청을 수락할 수 없다', async () => {
    const carol = await signUp(app, 'carol');
    const requestId = await sendFriendRequest(app, alice, bob);

    // 요청자 본인도, 무관한 제3자도 수락 불가. 존재 자체를 숨기려고 404 로 통일한다.
    for (const user of [alice, carol]) {
      const response = await app.inject({
        method: 'POST',
        url: `/friends/requests/${requestId}/accept`,
        headers: auth(user),
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('이미 처리된 요청은 다시 수락할 수 없다', async () => {
    const requestId = await sendFriendRequest(app, alice, bob);
    await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/accept`,
      headers: auth(bob),
    });

    const again = await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/accept`,
      headers: auth(bob),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('REQUEST_NOT_PENDING');
  });

  it('중복 요청은 409', async () => {
    await sendFriendRequest(app, alice, bob);

    const dup = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(alice),
      payload: { target_user_id: 'bob' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('REQUEST_ALREADY_PENDING');
  });

  it('서로 요청을 보내면 자동으로 친구가 된다', async () => {
    await sendFriendRequest(app, alice, bob);

    const response = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().request.status).toBe('accepted');
  });

  it('거절 후에도 다시 요청할 수 있다', async () => {
    const requestId = await sendFriendRequest(app, alice, bob);
    await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/reject`,
      headers: auth(bob),
    });

    const retry = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(alice),
      payload: { target_user_id: 'bob' },
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().request.status).toBe('pending');
  });

  it('자기 자신에게는 요청할 수 없다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(alice),
      payload: { target_user_id: 'alice' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('친구를 삭제하면 목록에서 사라진다', async () => {
    await becomeFriends(app, alice, bob);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/friends/${bob.id}`,
      headers: auth(alice),
    });
    expect(remove.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/friends', headers: auth(bob) });
    expect(list.json().friends).toHaveLength(0);
  });
});
