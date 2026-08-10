import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export type AccessTokenPayload = {
  sub: string;
  userId: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signAccessToken(user: { id: string; userId: string }): Promise<string> {
  const { ACCESS_TOKEN_TTL_SEC, JWT_ISSUER } = env();
  return new SignJWT({ userId: user.userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SEC)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: env().JWT_ISSUER });
    if (typeof payload.sub !== 'string' || typeof payload.userId !== 'string') {
      throw new Error('malformed payload');
    }
    return { sub: payload.sub, userId: payload.userId };
  } catch {
    throw unauthorized('INVALID_TOKEN', '토큰이 유효하지 않거나 만료되었습니다.');
  }
}

/**
 * refresh 토큰은 JWT 가 아니라 불투명한 난수다.
 * 서버가 폐기(회전/로그아웃/탈취 감지)를 즉시 강제할 수 있어야 하기 때문에
 * "검증만으로 통과하는" 자기완결적 토큰을 쓰지 않는다.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(prisma: PrismaClient, userId: string): Promise<string> {
  const token = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_SEC * 1000),
    },
  });
  return token;
}

export type RotationResult = { accessToken: string; refreshToken: string };

/**
 * 회전(rotation). 한 번 쓴 refresh 토큰은 즉시 폐기하고 새 토큰을 발급한다.
 *
 * 이미 폐기된 토큰이 다시 들어오면 = 누군가 오래된 토큰을 들고 있다는 뜻이므로
 * 해당 사용자의 모든 refresh 토큰을 날린다(재사용 감지). 정상 사용자는 재로그인하면 되고,
 * 탈취자는 세션을 잃는다.
 */
export async function rotateRefreshToken(
  prisma: PrismaClient,
  presented: string,
): Promise<RotationResult> {
  const tokenHash = hashRefreshToken(presented);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    throw unauthorized('INVALID_REFRESH_TOKEN', 'refresh 토큰이 유효하지 않습니다.');
  }

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('REFRESH_TOKEN_REUSED', '이미 사용된 refresh 토큰입니다. 다시 로그인해 주세요.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('REFRESH_TOKEN_EXPIRED', 'refresh 토큰이 만료되었습니다.');
  }

  if (!existing.user || existing.user.deletedAt) {
    throw unauthorized('ACCOUNT_DELETED', '삭제된 계정입니다.');
  }

  const nextToken = generateRefreshToken();
  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashRefreshToken(nextToken),
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_SEC * 1000),
      },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });
    return next;
  });

  void created;

  return {
    accessToken: await signAccessToken(existing.user),
    refreshToken: nextToken,
  };
}

export async function revokeRefreshToken(prisma: PrismaClient, presented: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(presented), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
