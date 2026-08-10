import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  auth,
  becomeFriends,
  createTestApp,
  prisma,
  resetDb,
  seedScheduledAlarm,
  signUp,
  type TestUser,
} from './helpers.js';
import type { NoopPushSender } from '../src/services/push.js';

describe('차단', () => {
  let app: FastifyInstance;
  let push: NoopPushSender;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    ({ app, push } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    push.sent.length = 0;
    alice = await signUp(app, 'alice');
    bob = await signUp(app, 'bob');
  });

  it('차단하면 예약돼 있던 알람이 blocked 로 바뀌고 취소 푸시가 나간다', async () => {
    await becomeFriends(app, alice, bob);
    const alarmId = await seedScheduledAlarm(alice, bob);

    const response = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().cancelled_alarm_count).toBe(1);

    const alarm = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
    expect(alarm.status).toBe('blocked');
    expect(alarm.cancelledAt).not.toBeNull();

    // 수신 기기가 로컬 알람을 취소할 수 있도록 취소 푸시가 큐잉된다
    expect(push.sent).toEqual([
      { userId: bob.id, message: { type: 'alarm.cancelled', alarmId, reason: 'blocked' } },
    ]);

    // 감사 로그
    const events = await prisma.alarmEvent.findMany({ where: { alarmId } });
    expect(events.map((e) => e.eventType)).toContain('blocked');
  });

  it('내가 상대에게 보내 둔 알람도 함께 취소된다 (차단 효과는 상호적)', async () => {
    await becomeFriends(app, alice, bob);
    const fromAlice = await seedScheduledAlarm(alice, bob);
    const fromBob = await seedScheduledAlarm(bob, alice);

    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const alarms = await prisma.alarm.findMany({ where: { id: { in: [fromAlice, fromBob] } } });
    expect(alarms.every((a) => a.status === 'blocked')).toBe(true);
  });

  it('차단하면 상대는 나를 검색할 수 없다 (차단 사실 은닉)', async () => {
    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const search = await app.inject({
      method: 'GET',
      url: '/users/search?user_id=bob',
      headers: auth(alice),
    });

    expect(search.statusCode).toBe(404);
    expect(search.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('차단된 상대의 친구 요청은 404 로 위장한다', async () => {
    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const request = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(alice),
      payload: { target_user_id: 'bob' },
    });

    expect(request.statusCode).toBe(404);
    expect(request.json().error.code).toBe('USER_NOT_FOUND');
    expect(await prisma.friendship.count()).toBe(0);
  });

  it('요청을 받아 둔 뒤 차단하면 수락할 수 없다', async () => {
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/friends/requests',
      headers: auth(alice),
      payload: { target_user_id: 'bob' },
    });
    const requestId = requestResponse.json().request.id;

    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const accept = await app.inject({
      method: 'POST',
      url: `/friends/requests/${requestId}/accept`,
      headers: auth(bob),
    });

    expect(accept.statusCode).toBe(403);
    expect(accept.json().error.code).toBe('BLOCKED');
  });

  it('차단 상대는 친구 목록에서 숨겨지고, 해제하면 돌아온다', async () => {
    await becomeFriends(app, alice, bob);

    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const hidden = await app.inject({ method: 'GET', url: '/friends', headers: auth(bob) });
    expect(hidden.json().friends).toHaveLength(0);

    await app.inject({
      method: 'DELETE',
      url: `/blocks/${alice.id}`,
      headers: auth(bob),
    });

    const restored = await app.inject({ method: 'GET', url: '/friends', headers: auth(bob) });
    expect(restored.json().friends.map((f: { user_id: string }) => f.user_id)).toEqual(['alice']);
  });

  it('차단을 풀어도 이미 blocked 된 알람은 되살아나지 않는다', async () => {
    await becomeFriends(app, alice, bob);
    const alarmId = await seedScheduledAlarm(alice, bob);

    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });
    await app.inject({
      method: 'DELETE',
      url: `/blocks/${alice.id}`,
      headers: auth(bob),
    });

    const alarm = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
    expect(alarm.status).toBe('blocked');
  });

  it('중복 차단은 에러가 아니다 (멱등)', async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/blocks',
        headers: auth(bob),
        payload: { target_user_id: 'alice' },
      });
      expect(response.statusCode).toBe(201);
    }

    expect(await prisma.block.count()).toBe(1);
  });

  it('자기 자신은 차단할 수 없다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(alice),
      payload: { target_user_id: 'alice' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('차단 목록은 본인이 차단한 사람만 보여준다', async () => {
    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(bob),
      payload: { target_user_id: 'alice' },
    });

    const bobList = await app.inject({ method: 'GET', url: '/blocks', headers: auth(bob) });
    expect(bobList.json().blocks).toHaveLength(1);

    // 차단당한 alice 에게는 아무것도 보이지 않는다
    const aliceList = await app.inject({ method: 'GET', url: '/blocks', headers: auth(alice) });
    expect(aliceList.json().blocks).toHaveLength(0);
  });
});
