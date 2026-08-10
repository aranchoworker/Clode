import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  becomeFriends,
  createTestApp,
  prisma,
  resetDb,
  seedScheduledAlarm,
  sendFriendRequest,
  signUp,
  type TestUser,
} from './helpers.js';
import {
  areFriends,
  assertCanSendAlarm,
  evaluateSendEligibility,
} from '../src/services/relationships.js';
import { ApiError } from '../src/lib/errors.js';

/**
 * 이 앱의 핵심 제약 세 가지에 대한 테스트.
 * 알람 API(Phase 4)가 아직 없으므로 규칙 엔진을 직접 호출해서 검증한다.
 * Phase 4 의 POST /alarms 와 GET /alarms/:id/validity 는 둘 다 이 함수를 호출하게 되어 있어서,
 * 여기서 통과하면 두 경로가 같은 판정을 한다는 게 보장된다.
 */
describe('알람 전송 규칙 (relationships)', () => {
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
    alice = await signUp(app);
    bob = await signUp(app);
  });

  describe('규칙 1 — 수락 없는 전송 금지', () => {
    it('아무 관계도 없으면 NOT_FRIENDS', async () => {
      const result = await evaluateSendEligibility(prisma, alice.id, bob.id);
      expect(result).toEqual({ allowed: false, reason: 'NOT_FRIENDS' });
    });

    it('요청만 보내고 수락 전이면 여전히 NOT_FRIENDS', async () => {
      await sendFriendRequest(app, alice, bob);

      const result = await evaluateSendEligibility(prisma, alice.id, bob.id);
      expect(result).toEqual({ allowed: false, reason: 'NOT_FRIENDS' });
      expect(await areFriends(prisma, alice.id, bob.id)).toBe(false);
    });

    it('거절당하면 NOT_FRIENDS', async () => {
      const requestId = await sendFriendRequest(app, alice, bob);
      await app.inject({
        method: 'POST',
        url: `/friends/requests/${requestId}/reject`,
        headers: { authorization: `Bearer ${bob.accessToken}` },
      });

      const result = await evaluateSendEligibility(prisma, alice.id, bob.id);
      expect(result).toEqual({ allowed: false, reason: 'NOT_FRIENDS' });
    });

    it('수락되면 양방향 모두 전송 가능', async () => {
      await becomeFriends(app, alice, bob);

      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({ allowed: true });
      // 관계 행은 alice -> bob 방향 하나지만, 판정은 방향에 무관해야 한다.
      expect(await evaluateSendEligibility(prisma, bob.id, alice.id)).toEqual({ allowed: true });
    });

    it('assertCanSendAlarm 은 403 NOT_FRIENDS 로 던진다', async () => {
      await expect(assertCanSendAlarm(prisma, alice.id, bob.id)).rejects.toMatchObject({
        statusCode: 403,
        code: 'NOT_FRIENDS',
      });
    });
  });

  describe('규칙 2 — 차단 시 전송 금지', () => {
    beforeEach(async () => {
      await becomeFriends(app, alice, bob);
    });

    it('수신자가 발신자를 차단하면 BLOCKED', async () => {
      await prisma.block.create({ data: { blockerId: bob.id, blockedId: alice.id } });

      await expect(assertCanSendAlarm(prisma, alice.id, bob.id)).rejects.toMatchObject({
        statusCode: 403,
        code: 'BLOCKED',
      });
    });

    it('차단은 단방향으로 기록해도 양방향 전송을 막는다', async () => {
      // bob 이 alice 를 차단 → alice 가 못 보내는 건 물론, bob 도 alice 에게 못 보낸다.
      await prisma.block.create({ data: { blockerId: bob.id, blockedId: alice.id } });

      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({
        allowed: false,
        reason: 'BLOCKED',
      });
      expect(await evaluateSendEligibility(prisma, bob.id, alice.id)).toEqual({
        allowed: false,
        reason: 'BLOCKED',
      });
    });

    it('차단을 풀면 다시 전송 가능', async () => {
      await prisma.block.create({ data: { blockerId: bob.id, blockedId: alice.id } });
      await prisma.block.deleteMany({ where: { blockerId: bob.id, blockedId: alice.id } });

      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({ allowed: true });
    });

    it('친구가 아니면서 차단 상태면 차단 사실을 감추고 NOT_FRIENDS 를 준다', async () => {
      const carol = await signUp(app);
      await prisma.block.create({ data: { blockerId: carol.id, blockedId: alice.id } });

      expect(await evaluateSendEligibility(prisma, alice.id, carol.id)).toEqual({
        allowed: false,
        reason: 'NOT_FRIENDS',
      });
    });
  });

  describe('규칙 3 — 발화 시점 재검증', () => {
    it('예약 시점에는 통과했어도, 그 뒤 차단되면 발화 판정에서 막힌다', async () => {
      await becomeFriends(app, alice, bob);

      // 예약 시점 판정
      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({ allowed: true });
      const alarmId = await seedScheduledAlarm(alice, bob);

      // 예약 후 bob 이 alice 를 차단
      await app.inject({
        method: 'POST',
        url: '/blocks',
        headers: { authorization: `Bearer ${bob.accessToken}` },
        payload: { target_user_id: alice.userId },
      });

      // 발화 직전 재검증 → 막혀야 한다
      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({
        allowed: false,
        reason: 'BLOCKED',
      });

      // 예약돼 있던 알람도 blocked 로 전환되어 있어야 한다
      const alarm = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
      expect(alarm.status).toBe('blocked');
    });

    it('예약 후 친구를 끊어도 발화 판정에서 막힌다', async () => {
      await becomeFriends(app, alice, bob);
      const alarmId = await seedScheduledAlarm(alice, bob);

      await app.inject({
        method: 'DELETE',
        url: `/friends/${alice.id}`,
        headers: { authorization: `Bearer ${bob.accessToken}` },
      });

      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({
        allowed: false,
        reason: 'NOT_FRIENDS',
      });

      const alarm = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
      expect(alarm.status).toBe('cancelled');
    });

    it('탈퇴한 수신자에게는 보낼 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      await prisma.user.update({ where: { id: bob.id }, data: { deletedAt: new Date() } });

      expect(await evaluateSendEligibility(prisma, alice.id, bob.id)).toEqual({
        allowed: false,
        reason: 'RECEIVER_NOT_FOUND',
      });
    });
  });

  describe('자기 자신', () => {
    it('자기 자신에게는 보낼 수 없다', async () => {
      const result = await evaluateSendEligibility(prisma, alice.id, alice.id);
      expect(result).toEqual({ allowed: false, reason: 'SELF' });

      await expect(assertCanSendAlarm(prisma, alice.id, alice.id)).rejects.toBeInstanceOf(ApiError);
    });
  });
});
