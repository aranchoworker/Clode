import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export type AuthUser = { id: string; userId: string; displayName: string };

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    /** 라우트에 { preHandler: app.requireAuth } 로 붙인다. */
    requireAuth: (request: FastifyRequest) => Promise<void>;
  }
}

/** 인증된 라우트 핸들러에서 쓰는 접근자. preHandler 를 안 붙였으면 여기서 걸린다. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw unauthorized();
  }
  return request.authUser;
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('authUser', undefined);

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('MISSING_TOKEN', '인증 토큰이 필요합니다.');
    }

    const payload = await verifyAccessToken(header.slice('Bearer '.length).trim());

    // 토큰은 유효해도 계정이 그 사이 삭제됐을 수 있다. access TTL(15분)만큼
    // 삭제된 계정이 살아 있으면 안 되므로 매 요청 확인한다.
    const user = await app.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, userId: true, displayName: true },
    });
    if (!user) {
      throw unauthorized('ACCOUNT_UNAVAILABLE', '사용할 수 없는 계정입니다.');
    }

    request.authUser = user;
  });
};

export default fp(authPlugin, { name: 'auth' });
