import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env } from './config/env.js';
import { ApiError } from './lib/errors.js';
import alarmsRoutes from './modules/alarms.routes.js';
import authRoutes from './modules/auth.routes.js';
import blocksRoutes from './modules/blocks.routes.js';
import devicesRoutes from './modules/devices.routes.js';
import friendsRoutes from './modules/friends.routes.js';
import storageRoutes from './modules/storage.routes.js';
import voiceMessagesRoutes from './modules/voiceMessages.routes.js';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import { NoopPushSender, type PushSender } from './services/push.js';
import { createFcmPushSender } from './services/pushFcm.js';
import { createStorage, type StorageAdapter } from './services/storage/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    push: PushSender;
    storage: StorageAdapter;
  }
}

export type BuildAppOptions = {
  prisma: PrismaClient;
  push?: PushSender;
  storage?: StorageAdapter;
  disconnectOnClose?: boolean;
  logger?: boolean;
};

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? env().NODE_ENV !== 'test',
    // 프록시 뒤에서 request.ip 가 전부 동일해지면 IP 단위 로그인 제한이 무력화된다.
    trustProxy: true,
    // 요청 바디에 음성 파일이 실릴 일은 없다(업로드는 presigned URL). 작게 잡는다.
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env().CORS_ORIGIN === '*' ? true : env().CORS_ORIGIN.split(',').map((s) => s.trim()),
  });

  // 전역 상한. 계정/IP 단위 로그인 백오프(loginThrottle)와는 별개의 거친 방어선이다.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // 테스트에서 429 로 흔들리지 않도록 끈다.
    global: env().NODE_ENV !== 'test',
  });

  await app.register(prismaPlugin, {
    client: opts.prisma,
    disconnectOnClose: opts.disconnectOnClose,
  });
  await app.register(authPlugin);
  await app.register(
    fp(async (instance) => {
      // opts.push 가 명시되면(테스트) 그걸 쓴다. 아니면 PUSH_DRIVER 설정을 따른다.
      const push = opts.push ?? (env().PUSH_DRIVER === 'fcm'
        ? createFcmPushSender(opts.prisma)
        : new NoopPushSender());
      instance.decorate('push', push);
      instance.decorate('storage', opts.storage ?? createStorage());
    }, { name: 'services' }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      // 4xx 는 정상적인 흐름이므로 error 레벨로 남기지 않는다.
      reply.code(error.statusCode).send(error.toJSON());
      return;
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      });
      return;
    }

    // 예상 못 한 오류. 여기서 error.message 를 그대로 내보내면 내부 구조가 새어 나갈 수 있다.
    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: '존재하지 않는 엔드포인트입니다.' },
    });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(devicesRoutes);
  await app.register(friendsRoutes);
  await app.register(blocksRoutes);
  await app.register(voiceMessagesRoutes);
  await app.register(storageRoutes);
  await app.register(alarmsRoutes);

  return app;
}
