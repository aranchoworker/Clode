import type { Prisma, PrismaClient } from '@prisma/client';
import { forbidden, notFound } from '../lib/errors.js';

/**
 * 이 앱의 핵심 제약이 전부 여기 모여 있다.
 *
 *   1. 수락 없는 전송 금지 — status='accepted' 인 친구 관계가 있을 때만 전송 가능
 *   2. 차단 시 전송 금지 — 어느 방향이든 차단 기록이 있으면 상호 전송 불가
 *   3. 발화 시점 재검증 — 예약 시점과 발화 직전에 "같은 함수"로 다시 판정
 *
 * 3번이 성립하려면 판정 로직이 한 곳에만 있어야 한다. 예약 경로와 발화 경로가 각자
 * 조건을 복사해 쓰면 언젠가 갈라지고, 갈라지는 순간 "차단했는데 울리는" 버그가 난다.
 * 그래서 라우트에서는 절대 직접 friendship/block 을 조회하지 않고 이 모듈만 호출한다.
 */

export type DenyReason = 'RECEIVER_NOT_FOUND' | 'SELF' | 'NOT_FRIENDS' | 'BLOCKED';

export type SendEligibility = { allowed: true } | { allowed: false; reason: DenyReason };

/** 트랜잭션 클라이언트도 그대로 받을 수 있게 최소 인터페이스로 받는다. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 두 사용자가 수락된 친구인지. friendships 는 방향이 있는 1행이므로 양방향으로 본다.
 */
export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await db.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 어느 방향으로든 차단 기록이 있는지.
 * 차단은 단방향으로 "기록"하지만, 전송 차단 효과는 상호적이다.
 */
export async function blockExistsBetween(db: Db, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 알람 전송/발화 가능 여부 판정. 예약 시점과 발화 직전에 동일하게 호출된다.
 *
 * 검사 순서는 친구 → 차단이다. 친구가 아닌 동시에 차단 상태이면 NOT_FRIENDS 가 나가는데,
 * 이건 의도된 동작이다(차단 사실을 굳이 알려주지 않는다).
 */
export async function evaluateSendEligibility(
  db: Db,
  senderId: string,
  receiverId: string,
): Promise<SendEligibility> {
  if (senderId === receiverId) {
    return { allowed: false, reason: 'SELF' };
  }

  const receiver = await db.user.findFirst({
    where: { id: receiverId, deletedAt: null },
    select: { id: true },
  });
  if (!receiver) {
    return { allowed: false, reason: 'RECEIVER_NOT_FOUND' };
  }

  if (!(await areFriends(db, senderId, receiverId))) {
    return { allowed: false, reason: 'NOT_FRIENDS' };
  }

  if (await blockExistsBetween(db, senderId, receiverId)) {
    return { allowed: false, reason: 'BLOCKED' };
  }

  return { allowed: true };
}

const DENY_MESSAGES: Record<DenyReason, string> = {
  RECEIVER_NOT_FOUND: '대상을 찾을 수 없습니다.',
  SELF: '자기 자신에게는 보낼 수 없습니다.',
  NOT_FRIENDS: '친구 요청이 수락되지 않아 알람을 보낼 수 없습니다.',
  BLOCKED: '차단된 상대에게는 알람을 보낼 수 없습니다.',
};

/** 라우트에서 쓰는 형태. 실패 시 스펙에 정의된 HTTP 코드로 던진다. */
export async function assertCanSendAlarm(
  db: Db,
  senderId: string,
  receiverId: string,
): Promise<void> {
  const result = await evaluateSendEligibility(db, senderId, receiverId);
  if (result.allowed) return;

  if (result.reason === 'RECEIVER_NOT_FOUND') {
    throw notFound('USER_NOT_FOUND', DENY_MESSAGES.RECEIVER_NOT_FOUND);
  }
  if (result.reason === 'SELF') {
    throw forbidden('SELF_TARGET', DENY_MESSAGES.SELF);
  }
  throw forbidden(result.reason, DENY_MESSAGES[result.reason]);
}
