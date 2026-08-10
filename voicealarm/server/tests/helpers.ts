import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { NoopPushSender } from '../src/services/push.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
});

export type TestContext = {
  app: FastifyInstance;
  push: NoopPushSender;
};

export async function createTestApp(): Promise<TestContext> {
  const push = new NoopPushSender();
  const app = await buildApp({ prisma, push, logger: false });
  await app.ready();
  return { app, push };
}

/** 테이블 truncate. 외래키 때문에 순서가 중요하므로 CASCADE 로 한 번에 비운다. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      alarm_events, reports, alarms, voice_messages,
      blocks, friendships, refresh_tokens, devices, auth_throttle, users
    RESTART IDENTITY CASCADE
  `);
}

export type TestUser = {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
};

let counter = 0;

/** 가입 API 를 통해 사용자를 만든다(해싱·검증 경로를 실제로 태우기 위해). */
export async function signUp(app: FastifyInstance, userId?: string): Promise<TestUser> {
  const id = userId ?? `user${++counter}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { user_id: id, password: 'password123', display_name: id },
  });

  if (response.statusCode !== 201) {
    throw new Error(`signUp failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  return {
    id: body.user.id,
    userId: body.user.user_id,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  };
}

export function auth(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.accessToken}` };
}

/** A -> B 친구 요청을 보내고 요청 ID 를 돌려준다(수락은 하지 않는다). */
export async function sendFriendRequest(
  app: FastifyInstance,
  from: TestUser,
  to: TestUser,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/friends/requests',
    headers: auth(from),
    payload: { target_user_id: to.userId },
  });
  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`friend request failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().request.id;
}

/** A -> B 요청 후 B 가 수락까지 마친 상태를 만든다. */
export async function becomeFriends(
  app: FastifyInstance,
  a: TestUser,
  b: TestUser,
): Promise<void> {
  const requestId = await sendFriendRequest(app, a, b);
  const response = await app.inject({
    method: 'POST',
    url: `/friends/requests/${requestId}/accept`,
    headers: auth(b),
  });
  if (response.statusCode !== 200) {
    throw new Error(`accept failed: ${response.statusCode} ${response.body}`);
  }
}

/** 알람 API 는 Phase 4 이므로, 규칙 검증을 위해 예약 알람을 DB 에 직접 만든다. */
export async function seedScheduledAlarm(
  sender: TestUser,
  receiver: TestUser,
  scheduledAt = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string> {
  const voice = await prisma.voiceMessage.create({
    data: {
      ownerId: sender.id,
      storageKey: `voice/${sender.id}/${Date.now()}.m4a`,
      durationMs: 5_000,
      mimeType: 'audio/mp4',
    },
  });

  const alarm = await prisma.alarm.create({
    data: {
      senderId: sender.id,
      receiverId: receiver.id,
      voiceMessageId: voice.id,
      scheduledAt,
      timezone: 'Asia/Seoul',
      status: 'scheduled',
    },
  });

  return alarm.id;
}
