import type { Prisma } from '@prisma/client';
import type { Db } from './relationships.js';

/**
 * 푸시 전송 경계. 실제 FCM/APNs 연동은 Phase 4 에서 이 인터페이스 뒤에 붙인다.
 *
 * Phase 1 에서 이걸 미리 두는 이유: 차단 처리가 "예약된 알람을 취소하고 수신 기기에
 * 취소를 알린다"까지가 한 동작이기 때문이다. 전송부를 나중에 끼워 넣더라도
 * 호출 지점과 감사 로그(alarm_events)는 지금 확정해 둔다.
 */

export type PushMessage =
  | { type: 'alarm.scheduled'; alarmId: string }
  | { type: 'alarm.cancelled'; alarmId: string; reason: 'blocked' | 'cancelled' | 'unfriended' };

export interface PushSender {
  /** 해당 사용자의 모든 등록 기기로 데이터 푸시를 보낸다. */
  sendToUser(userId: string, message: PushMessage): Promise<void>;
}

/**
 * Phase 1 기본 구현. 전송하지 않고 큐잉만 기록한다.
 * "보낸 척"하지 않기 위해 이름과 로그를 명확히 남긴다.
 */
export class NoopPushSender implements PushSender {
  readonly sent: Array<{ userId: string; message: PushMessage }> = [];

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    this.sent.push({ userId, message });
  }
}

/** 알람 상태 변화를 감사 로그에 남긴다. 디버깅 시 "왜 안 울렸는가"의 근거가 된다. */
export async function recordAlarmEvent(
  db: Db,
  alarmId: string,
  eventType: string,
  payload?: Prisma.InputJsonObject,
): Promise<void> {
  await db.alarmEvent.create({
    data: { alarmId, eventType, payload: payload ?? undefined },
  });
}
