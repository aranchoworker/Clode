import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FcmPushSender } from '../src/services/pushFcm.js';
import { prisma, resetDb, signUp, createTestApp } from './helpers.js';

/**
 * 실제 firebase-service-account.json 이 있을 때만 돈다(레포에 커밋되지 않는 파일이라
 * CI/다른 개발자 환경에는 없을 수 있다). 여기서는 FCM 서버에 실제로 요청을 보내되,
 * 존재하지 않는 더미 기기 토큰을 써서 "invalid registration token" 응답을 받는다 —
 * 즉, 자격증명 자체가 유효한지, 클라이언트 초기화가 되는지, dead-token 정리 로직이
 * 실제 에러 코드를 올바르게 인식하는지를 검증한다. 실기기로 알림이 도착하는지는
 * 이 테스트의 범위가 아니다(그건 앱을 실기기에 올려야 확인 가능).
 */
const KEY_PATH = resolve(import.meta.dirname, '../firebase-service-account.json');

describe.skipIf(!existsSync(KEY_PATH))('FcmPushSender (실제 자격증명)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('서비스 계정 키로 초기화되고, 존재하지 않는 토큰에는 실패 응답을 받는다', async () => {
    await resetDb();
    const { app } = await createTestApp();
    const user = await signUp(app);

    await prisma.device.create({
      data: {
        userId: user.id,
        platform: 'android',
        pushToken: 'dummy-invalid-token-for-fcm-credential-check',
      },
    });

    const sender = new FcmPushSender(prisma, KEY_PATH);

    // 실패해도 예외를 밖으로 던지지 않는다(Promise.allSettled 로 감싸져 있음).
    await expect(
      sender.sendToUser(user.id, { type: 'alarm.scheduled', alarmId: 'test-alarm-id' }),
    ).resolves.toBeUndefined();

    // 무효 토큰이므로 정리 로직이 기기를 지웠어야 한다 — 이게 통과하려면
    // FCM 이 실제로 "등록되지 않은 토큰"이라고 응답했다는 뜻이다(= 자격증명이 유효함).
    const remaining = await prisma.device.count({ where: { userId: user.id } });
    expect(remaining).toBe(0);

    await app.close();
  });
});
