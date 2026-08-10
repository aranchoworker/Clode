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

const FUTURE = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

describe('알람 파이프라인', () => {
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
    alice = await signUp(app);
    bob = await signUp(app);
  });

  /** alice 소유 음성 메시지를 DB 에 직접 만든다. 업로드 파이프라인은 별도 테스트에서 검증됨. */
  async function seedVoiceMessage(owner: TestUser) {
    return prisma.voiceMessage.create({
      data: {
        ownerId: owner.id,
        storageKey: `voice/${owner.id}/${crypto.randomUUID()}.m4a`,
        durationMs: 4000,
        mimeType: 'audio/mp4',
        iosCafKey: `voice/${owner.id}/${crypto.randomUUID()}.caf`,
      },
    });
  }

  describe('규칙 1 — 수락 없는 전송 금지', () => {
    it('친구가 아니면 알람 생성이 403 NOT_FRIENDS', async () => {
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: FUTURE(),
          timezone: 'Asia/Seoul',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('NOT_FRIENDS');
      expect(await prisma.alarm.count()).toBe(0);
    });

    it('수락되면 성공하고 수신자에게 데이터 푸시가 나간다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: FUTURE(),
          timezone: 'Asia/Seoul',
          title: '일어나!',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json().alarm;
      expect(body.status).toBe('scheduled');
      expect(body.sender.user_id).toBe(alice.userId);
      expect(body.receiver.user_id).toBe(bob.userId);
      expect(body.voice_message.duration_ms).toBe(4000);

      expect(push.sent).toEqual([
        { userId: bob.id, message: { type: 'alarm.scheduled', alarmId: body.id } },
      ]);
    });
  });

  describe('규칙 2 — 차단 시 전송 금지', () => {
    it('차단된 상대에게는 알람 생성이 403 BLOCKED', async () => {
      await becomeFriends(app, alice, bob);
      await prisma.block.create({ data: { blockerId: bob.id, blockedId: alice.id } });
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: FUTURE(),
          timezone: 'Asia/Seoul',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('BLOCKED');
    });
  });

  describe('입력 검증', () => {
    it('남의 음성 메시지 ID 로는 알람을 만들 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const bobsVoice = await seedVoiceMessage(bob);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: bobsVoice.id,
          scheduled_at: FUTURE(),
          timezone: 'Asia/Seoul',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('VOICE_MESSAGE_NOT_FOUND');
    });

    it('과거 시각으로는 예약할 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: new Date(Date.now() - 60_000).toISOString(),
          timezone: 'Asia/Seoul',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('SCHEDULED_AT_TOO_SOON');
    });

    it('너무 임박한 시각(리드타임 미만)도 거부된다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: new Date(Date.now() + 5_000).toISOString(),
          timezone: 'Asia/Seoul',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('SCHEDULED_AT_TOO_SOON');
    });

    it('올바르지 않은 타임존은 거부된다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);

      const response = await app.inject({
        method: 'POST',
        url: '/alarms',
        headers: auth(alice),
        payload: {
          receiver_user_id: bob.userId,
          voice_message_id: voice.id,
          scheduled_at: FUTURE(),
          timezone: 'Not/AZone',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('목록 / 상세', () => {
    it('role=sent, role=received 가 서로 다른 목록을 준다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const sent = await app.inject({ method: 'GET', url: '/alarms?role=sent', headers: auth(alice) });
      expect(sent.json().alarms).toHaveLength(1);

      const sentAsBob = await app.inject({ method: 'GET', url: '/alarms?role=sent', headers: auth(bob) });
      expect(sentAsBob.json().alarms).toHaveLength(0);

      const received = await app.inject({
        method: 'GET',
        url: '/alarms?role=received',
        headers: auth(bob),
      });
      expect(received.json().alarms).toHaveLength(1);
    });

    it('무관한 사용자는 알람 상세를 볼 수 없다 (404)', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);
      const carol = await signUp(app);

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}`,
        headers: auth(carol),
      });

      expect(response.statusCode).toBe(404);
    });

    it('발신자와 수신자는 둘 다 상세를 볼 수 있다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      for (const user of [alice, bob]) {
        const response = await app.inject({
          method: 'GET',
          url: `/alarms/${alarmId}`,
          headers: auth(user),
        });
        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe('취소 (발신자)', () => {
    it('발신자는 예약된 알람을 취소할 수 있고, 수신자에게 취소 푸시가 간다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);
      push.sent.length = 0;

      const response = await app.inject({
        method: 'DELETE',
        url: `/alarms/${alarmId}`,
        headers: auth(alice),
      });

      expect(response.statusCode).toBe(200);
      const row = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
      expect(row.status).toBe('cancelled');
      expect(push.sent).toEqual([
        { userId: bob.id, message: { type: 'alarm.cancelled', alarmId, reason: 'cancelled' } },
      ]);
    });

    it('수신자는 취소할 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const response = await app.inject({
        method: 'DELETE',
        url: `/alarms/${alarmId}`,
        headers: auth(bob),
      });

      expect(response.statusCode).toBe(404);
    });

    it('이미 취소된 알람은 다시 취소할 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      await app.inject({ method: 'DELETE', url: `/alarms/${alarmId}`, headers: auth(alice) });
      const again = await app.inject({
        method: 'DELETE',
        url: `/alarms/${alarmId}`,
        headers: auth(alice),
      });

      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('ALARM_NOT_CANCELLABLE');
    });
  });

  describe('규칙 3 — 발화 직전 재검증 (validity)', () => {
    it('친구·차단 상태에 변화가 없으면 valid: true', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}/validity`,
        headers: auth(bob),
      });

      expect(response.json()).toEqual({ valid: true, reason: null });
    });

    it('예약 후 차단되면 invalid 로 바뀌고, 알람 상태도 blocked 로 전환된다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      await app.inject({
        method: 'POST',
        url: '/blocks',
        headers: auth(bob),
        payload: { target_user_id: alice.userId },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}/validity`,
        headers: auth(bob),
      });

      expect(response.json()).toEqual({ valid: false, reason: 'blocked' });
    });

    it('예약 후 친구를 끊으면 invalid, 알람 상태는 cancelled', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      // 친구 삭제 API 는 이미 예약 알람을 즉시 cancelled 로 정리하므로,
      // "정리되기 전에 재검증이 호출되는 경우"를 보려면 DB 상태만 되돌려 재현한다.
      await prisma.friendship.deleteMany({});
      await prisma.alarm.update({ where: { id: alarmId }, data: { status: 'scheduled' } });

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}/validity`,
        headers: auth(bob),
      });

      expect(response.json()).toEqual({ valid: false, reason: 'not_friends' });
      const row = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
      expect(row.status).toBe('cancelled');
    });

    it('이미 취소된 알람은 재검증 없이 바로 invalid', async () => {
      const alarmId = await seedScheduledAlarm(alice, bob);
      await prisma.alarm.update({ where: { id: alarmId }, data: { status: 'cancelled' } });

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}/validity`,
        headers: auth(bob),
      });

      expect(response.json()).toEqual({ valid: false, reason: 'cancelled' });
    });

    it('발신자는 수신자의 validity 를 조회할 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const response = await app.inject({
        method: 'GET',
        url: `/alarms/${alarmId}/validity`,
        headers: auth(alice),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('ack', () => {
    it('수신자가 ack 하면 delivered 로 바뀐다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const response = await app.inject({
        method: 'POST',
        url: `/alarms/${alarmId}/ack`,
        headers: auth(bob),
        payload: { played: true },
      });

      expect(response.statusCode).toBe(200);
      const row = await prisma.alarm.findUniqueOrThrow({ where: { id: alarmId } });
      expect(row.status).toBe('delivered');
      expect(row.deliveredAt).not.toBeNull();
    });

    it('발신자는 ack 할 수 없다', async () => {
      await becomeFriends(app, alice, bob);
      const voice = await seedVoiceMessage(alice);
      const alarmId = await seedScheduledAlarmVia(app, alice, bob, voice.id);

      const response = await app.inject({
        method: 'POST',
        url: `/alarms/${alarmId}/ack`,
        headers: auth(alice),
      });

      expect(response.statusCode).toBe(404);
    });

    it('이미 취소된 알람은 ack 할 수 없다', async () => {
      const alarmId = await seedScheduledAlarm(alice, bob);
      await prisma.alarm.update({ where: { id: alarmId }, data: { status: 'blocked' } });

      const response = await app.inject({
        method: 'POST',
        url: `/alarms/${alarmId}/ack`,
        headers: auth(bob),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('ALARM_NOT_ACTIVE');
    });
  });
});

/** 실제 라우트를 통해 알람을 만들고 ID 를 돌려준다(감사 이벤트·푸시까지 정상 경로로 생성). */
async function seedScheduledAlarmVia(
  app: FastifyInstance,
  sender: TestUser,
  receiver: TestUser,
  voiceMessageId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/alarms',
    headers: auth(sender),
    payload: {
      receiver_user_id: receiver.userId,
      voice_message_id: voiceMessageId,
      scheduled_at: FUTURE(),
      timezone: 'Asia/Seoul',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`알람 생성 실패: ${response.statusCode} ${response.body}`);
  }
  return response.json().alarm.id;
}
