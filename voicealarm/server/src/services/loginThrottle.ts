import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';

/**
 * 로그인 브루트포스 방어. 계정 단위와 IP 단위를 각각 센다.
 *
 * - 계정 단위만 세면 공격자가 한 IP 에서 여러 계정을 훑는 걸 못 막는다.
 * - IP 단위만 세면 공유 NAT 뒤 정상 사용자들이 같이 잠긴다.
 *
 * 임계치(기본 5회)를 넘으면 초과분마다 잠금 시간이 2배로 늘어난다(30초 → 60 → 120 …, 상한 1시간).
 */

function lockDurationSec(failCount: number): number {
  const { LOGIN_FAIL_THRESHOLD, LOGIN_LOCK_BASE_SEC, LOGIN_LOCK_MAX_SEC } = env();
  const over = failCount - LOGIN_FAIL_THRESHOLD;
  if (over < 0) return 0;
  return Math.min(LOGIN_LOCK_BASE_SEC * 2 ** over, LOGIN_LOCK_MAX_SEC);
}

export function accountKey(userId: string): string {
  return `user:${userId}`;
}

export function ipKey(ip: string): string {
  return `ip:${ip}`;
}

/** 잠겨 있으면 429 를 던진다. 로그인 시도 "전"에 호출한다. */
export async function assertNotLocked(prisma: PrismaClient, keys: string[]): Promise<void> {
  const now = new Date();
  const locked = await prisma.authThrottle.findFirst({
    where: { key: { in: keys }, lockedUntil: { gt: now } },
    orderBy: { lockedUntil: 'desc' },
  });

  if (locked?.lockedUntil) {
    const retryAfter = Math.ceil((locked.lockedUntil.getTime() - now.getTime()) / 1000);
    throw tooManyRequests(
      'TOO_MANY_LOGIN_ATTEMPTS',
      `로그인 시도가 너무 많습니다. ${retryAfter}초 후에 다시 시도해 주세요.`,
      { retryAfterSec: retryAfter },
    );
  }
}

/** 로그인 실패 기록. */
export async function recordFailure(prisma: PrismaClient, keys: string[]): Promise<void> {
  const now = new Date();
  for (const key of keys) {
    const row = await prisma.authThrottle.upsert({
      where: { key },
      create: { key, failCount: 1 },
      update: { failCount: { increment: 1 } },
    });

    const seconds = lockDurationSec(row.failCount);
    if (seconds > 0) {
      await prisma.authThrottle.update({
        where: { key },
        data: { lockedUntil: new Date(now.getTime() + seconds * 1000) },
      });
    }
  }
}

/** 로그인 성공 시 카운터를 지운다. */
export async function clearFailures(prisma: PrismaClient, keys: string[]): Promise<void> {
  await prisma.authThrottle.deleteMany({ where: { key: { in: keys } } });
}
