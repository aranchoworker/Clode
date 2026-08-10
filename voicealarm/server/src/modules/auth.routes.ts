import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { conflict, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../lib/tokens.js';
import {
  displayNameSchema,
  parseOrThrow,
  passwordSchema,
  userIdSchema,
} from '../lib/validation.js';
import {
  accountKey,
  assertNotLocked,
  clearFailures,
  ipKey,
  recordFailure,
} from '../services/loginThrottle.js';
import { env } from '../config/env.js';
import { currentUser } from '../plugins/auth.js';
import { publicUser } from '../lib/serialize.js';

const signupBody = z.object({
  user_id: userIdSchema,
  password: passwordSchema,
  display_name: displayNameSchema,
});

const loginBody = z.object({
  user_id: userIdSchema,
  password: z.string().min(1),
});

const refreshBody = z.object({ refresh_token: z.string().min(1) });

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/signup', async (request, reply) => {
    const body = parseOrThrow(signupBody, request.body);

    const existing = await app.prisma.user.findUnique({
      where: { userId: body.user_id },
      select: { id: true },
    });
    if (existing) {
      throw conflict('USER_ID_TAKEN', '이미 사용 중인 아이디입니다.');
    }

    const user = await app.prisma.user.create({
      data: {
        userId: body.user_id,
        passwordHash: await hashPassword(body.password),
        displayName: body.display_name,
      },
      select: { id: true, userId: true, displayName: true },
    });

    reply.code(201);
    return {
      user: publicUser(user),
      access_token: await signAccessToken(user),
      refresh_token: await issueRefreshToken(app.prisma, user.id),
      expires_in: env().ACCESS_TOKEN_TTL_SEC,
    };
  });

  app.post('/auth/login', async (request) => {
    const body = parseOrThrow(loginBody, request.body);
    const keys = [accountKey(body.user_id), ipKey(request.ip)];

    await assertNotLocked(app.prisma, keys);

    const user = await app.prisma.user.findFirst({
      where: { userId: body.user_id, deletedAt: null },
    });

    // 아이디가 없어도 해시 검증 비용을 한 번 치러 타이밍 차이로 계정 존재 여부가
    // 새어 나가지 않게 한다. 응답 코드도 동일하다.
    const ok = user
      ? await verifyPassword(body.password, user.passwordHash)
      : await verifyPassword(body.password, DUMMY_HASH);

    if (!user || !ok) {
      await recordFailure(app.prisma, keys);
      throw unauthorized('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    await clearFailures(app.prisma, keys);

    return {
      user: publicUser(user),
      access_token: await signAccessToken(user),
      refresh_token: await issueRefreshToken(app.prisma, user.id),
      expires_in: env().ACCESS_TOKEN_TTL_SEC,
    };
  });

  app.post('/auth/refresh', async (request) => {
    const body = parseOrThrow(refreshBody, request.body);
    const rotated = await rotateRefreshToken(app.prisma, body.refresh_token);
    return {
      access_token: rotated.accessToken,
      refresh_token: rotated.refreshToken,
      expires_in: env().ACCESS_TOKEN_TTL_SEC,
    };
  });

  app.post('/auth/logout', async (request) => {
    const body = parseOrThrow(refreshBody, request.body);
    await revokeRefreshToken(app.prisma, body.refresh_token);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.requireAuth }, async (request) => {
    return { user: publicUser(currentUser(request)) };
  });
};

/**
 * 존재하지 않는 아이디로 로그인할 때 비교용으로 쓰는 더미 해시.
 * 값 자체는 의미 없고, argon2 검증에 걸리는 시간을 맞추는 용도다.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$c29tZXNhbHR2YWx1ZTE$Zt0mjJ5DkJlLmA1qFfKJmn0Ck0z6bU3XeYt1fJc1kGE';

export default authRoutes;
