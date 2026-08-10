import { existsSync } from 'node:fs';
import type { App } from 'firebase-admin/app';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import type { PushMessage, PushSender } from './push.js';

/**
 * 실제 FCM 데이터 푸시 발송.
 *
 * "조용한" 데이터 메시지로 보낸다(알림 배너 없음). 배너가 있는 알림 메시지는 OS가
 * 표시를 대신 처리해 버려서 앱 코드가 못 받는 경우가 있는데, 우리는 이 푸시를
 * "음성 파일을 미리 받아서 로컬 알람을 등록하라"는 트리거로 써야 하므로 반드시
 * 앱 코드까지 전달돼야 한다.
 *
 * 페이로드는 최소한만 담는다(type, alarm_id). 나머지(발신자 이름, 녹음 URL 등)는
 * 앱이 access token 으로 GET /alarms/:id 를 호출해 받는다 — 그래야 access token
 * 만료·회전과 무관하게 항상 최신 정보를 받고, 죽은 토큰이 새 정보를 안 받는
 * 상황도 안 생긴다.
 */
export class FcmPushSender implements PushSender {
  private readonly app: App;
  private readonly messaging: Messaging;

  constructor(
    private readonly prisma: PrismaClient,
    serviceAccountPath: string,
  ) {
    if (!existsSync(serviceAccountPath)) {
      throw new Error(
        `Firebase 서비스 계정 키를 찾을 수 없습니다: ${serviceAccountPath}\n` +
          `PUSH_DRIVER=fcm 을 쓰려면 Firebase 콘솔에서 발급한 키를 이 경로에 둬야 합니다.`,
      );
    }
    this.app = initializeApp({ credential: cert(serviceAccountPath) });
    this.messaging = getMessaging(this.app);
  }

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { id: true, platform: true, pushToken: true },
    });
    if (devices.length === 0) return;

    const data = toDataPayload(message);

    const results = await Promise.allSettled(
      devices.map((device) =>
        this.messaging.send({
          token: device.pushToken,
          data,
          android: {
            // 알람 트리거이므로 지연 없이 즉시 전달돼야 한다. 배터리 최적화로
            // 묶여서 늦게 오면 예약 시각을 놓칠 수 있다.
            priority: 'high',
          },
          apns: {
            headers: { 'apns-priority': '5' },
            payload: {
              aps: {
                // 알림 배너 없이 백그라운드에서 앱을 깨우기만 한다.
                'content-available': 1,
              },
            },
          },
        }),
      ),
    );

    // 만료되거나 앱이 삭제된 기기의 토큰은 계속 실패하며 쌓인다. 정리하지 않으면
    // 다음 알람마다 똑같은 죽은 토큰에 매번 발송을 시도하게 된다.
    const staleDeviceIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected' && isUnregisteredError(result.reason)) {
        staleDeviceIds.push(devices[index]!.id);
      }
    });
    if (staleDeviceIds.length > 0) {
      await this.prisma.device.deleteMany({ where: { id: { in: staleDeviceIds } } });
    }
  }
}

function toDataPayload(message: PushMessage): Record<string, string> {
  if (message.type === 'alarm.scheduled') {
    return { type: message.type, alarm_id: message.alarmId };
  }
  return { type: message.type, alarm_id: message.alarmId, reason: message.reason };
}

function isUnregisteredError(reason: unknown): boolean {
  const code = (reason as { code?: string } | undefined)?.code;
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument';
}

let fcmSingleton: FcmPushSender | null = null;

/** PUSH_DRIVER=fcm 일 때만 app.ts 에서 호출한다. */
export function createFcmPushSender(prisma: PrismaClient): PushSender {
  fcmSingleton ??= new FcmPushSender(prisma, env().FIREBASE_SERVICE_ACCOUNT_PATH);
  return fcmSingleton;
}
