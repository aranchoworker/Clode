import type { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Prisma 인스턴스를 app 에 붙인다. 테스트에서는 이미 만들어 둔 클라이언트를 주입해
 * 테스트 파일마다 커넥션 풀이 새로 뜨는 걸 막는다.
 */
const prismaPlugin: FastifyPluginAsync<{ client: PrismaClient; disconnectOnClose?: boolean }> =
  async (app, opts) => {
    app.decorate('prisma', opts.client);

    if (opts.disconnectOnClose) {
      app.addHook('onClose', async () => {
        await opts.client.$disconnect();
      });
    }
  };

export default fp(prismaPlugin, { name: 'prisma' });
