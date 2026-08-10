import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../lib/validation.js';
import { currentUser } from '../plugins/auth.js';

const registerBody = z.object({
  platform: z.enum(['ios', 'android']),
  push_token: z.string().min(1).max(512),
  app_version: z.string().max(32).optional(),
});

const devicesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 푸시 토큰 등록/갱신.
   *
   * 같은 토큰이 다른 계정으로 다시 등록되는 경우가 실제로 흔하다(기기 물려주기, 재로그인).
   * 그때 소유자를 옮기지 않으면 이전 사용자의 알람이 새 사용자 기기로 간다.
   * 그래서 push_token 을 유니크 키로 두고 upsert 로 소유자를 덮어쓴다.
   */
  app.post('/devices', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = currentUser(request);
    const body = parseOrThrow(registerBody, request.body);

    const device = await app.prisma.device.upsert({
      where: { pushToken: body.push_token },
      create: {
        userId: me.id,
        platform: body.platform,
        pushToken: body.push_token,
        appVersion: body.app_version,
      },
      update: {
        userId: me.id,
        platform: body.platform,
        appVersion: body.app_version,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, lastSeenAt: true },
    });

    reply.code(201);
    return {
      device: {
        id: device.id,
        platform: device.platform,
        last_seen_at: device.lastSeenAt.toISOString(),
      },
    };
  });

  app.delete('/devices', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const body = parseOrThrow(z.object({ push_token: z.string().min(1) }), request.body);

    await app.prisma.device.deleteMany({
      where: { userId: me.id, pushToken: body.push_token },
    });

    return { ok: true };
  });
};

export default devicesRoutes;
