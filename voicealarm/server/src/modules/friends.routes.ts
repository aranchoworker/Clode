import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { friendRequest, publicUser } from '../lib/serialize.js';
import { parseOrThrow, userIdSchema, uuidSchema } from '../lib/validation.js';
import { currentUser } from '../plugins/auth.js';
import { blockExistsBetween, type Db } from '../services/relationships.js';

const USER_SELECT = { id: true, userId: true, displayName: true } as const;

const REQUEST_INCLUDE = {
  requester: { select: USER_SELECT },
  addressee: { select: USER_SELECT },
} as const;

const searchQuery = z.object({ user_id: userIdSchema });
const createRequestBody = z.object({ target_user_id: userIdSchema });
const idParam = z.object({ id: uuidSchema });
const listQuery = z.object({ direction: z.enum(['incoming', 'outgoing']).default('incoming') });

const friendsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 아이디 정확 일치 검색만 제공한다. 부분 검색(LIKE)은 아이디를 훑어서
   * 대상을 찾아내는 스토킹 경로가 되므로 만들지 않는다.
   */
  app.get('/users/search', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const query = parseOrThrow(searchQuery, request.query);

    const found = await app.prisma.user.findFirst({
      where: { userId: query.user_id, deletedAt: null },
      select: USER_SELECT,
    });

    // 차단 관계면 "없는 사용자"처럼 보이게 한다. 여기서 존재를 알려주면
    // 차단당한 쪽이 상대의 계정 상태를 계속 확인할 수 있게 된다.
    if (!found || (await blockExistsBetween(app.prisma, me.id, found.id))) {
      throw notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
    }

    const relation = await findFriendshipBetween(app.prisma, me.id, found.id);

    return {
      user: publicUser(found),
      relation: relation
        ? {
            status: relation.status,
            direction: relation.requesterId === me.id ? 'outgoing' : 'incoming',
            request_id: relation.id,
          }
        : null,
      is_self: found.id === me.id,
    };
  });

  app.post('/friends/requests', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = currentUser(request);
    const body = parseOrThrow(createRequestBody, request.body);

    const target = await app.prisma.user.findFirst({
      where: { userId: body.target_user_id, deletedAt: null },
      select: USER_SELECT,
    });

    if (!target) {
      throw notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
    }
    if (target.id === me.id) {
      throw badRequest('SELF_REQUEST', '자기 자신에게는 친구 요청을 보낼 수 없습니다.');
    }
    // 차단 관계에서도 동일하게 404. 400/403 을 주면 차단 사실이 드러난다.
    if (await blockExistsBetween(app.prisma, me.id, target.id)) {
      throw notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
    }

    const existing = await findFriendshipBetween(app.prisma, me.id, target.id);

    if (existing?.status === 'accepted') {
      throw conflict('ALREADY_FRIENDS', '이미 친구입니다.');
    }

    if (existing?.status === 'pending') {
      // 상대가 이미 나에게 보낸 요청이 있으면, 맞요청을 수락으로 처리한다.
      // 양쪽이 서로 요청만 보내 놓고 아무도 친구가 안 되는 상태를 막는다.
      if (existing.addresseeId === me.id) {
        const accepted = await app.prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'accepted', respondedAt: new Date() },
          include: REQUEST_INCLUDE,
        });
        return { request: friendRequest(accepted, me.id) };
      }
      throw conflict('REQUEST_ALREADY_PENDING', '이미 보낸 친구 요청이 있습니다.');
    }

    // rejected / cancelled 로 남아 있던 행은 재사용한다.
    // (requester, addressee) UNIQUE 제약 때문에 새 행을 만들 수 없기도 하고,
    // 거절 이력이 영구 차단처럼 동작하면 안 되기 때문이다.
    if (existing) {
      const revived = await app.prisma.friendship.update({
        where: { id: existing.id },
        data: {
          requesterId: me.id,
          addresseeId: target.id,
          status: 'pending',
          requestedAt: new Date(),
          respondedAt: null,
        },
        include: REQUEST_INCLUDE,
      });
      reply.code(201);
      return { request: friendRequest(revived, me.id) };
    }

    const created = await app.prisma.friendship.create({
      data: { requesterId: me.id, addresseeId: target.id, status: 'pending' },
      include: REQUEST_INCLUDE,
    });

    reply.code(201);
    return { request: friendRequest(created, me.id) };
  });

  app.get('/friends/requests', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { direction } = parseOrThrow(listQuery, request.query);

    const rows = await app.prisma.friendship.findMany({
      where: {
        status: 'pending',
        ...(direction === 'incoming' ? { addresseeId: me.id } : { requesterId: me.id }),
      },
      include: REQUEST_INCLUDE,
      orderBy: { requestedAt: 'desc' },
    });

    return { requests: rows.map((row) => friendRequest(row, me.id)) };
  });

  app.post('/friends/requests/:id/accept', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await loadPendingRequestForAddressee(app.prisma, id, me.id);

    // 요청을 받아 둔 사이에 차단이 생겼을 수 있다. 수락으로 차단을 우회하지 못하게 막는다.
    if (await blockExistsBetween(app.prisma, row.requesterId, row.addresseeId)) {
      throw forbidden('BLOCKED', '차단 관계에서는 친구 요청을 수락할 수 없습니다.');
    }

    const updated = await app.prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'accepted', respondedAt: new Date() },
      include: REQUEST_INCLUDE,
    });

    return { request: friendRequest(updated, me.id) };
  });

  app.post('/friends/requests/:id/reject', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await loadPendingRequestForAddressee(app.prisma, id, me.id);

    const updated = await app.prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'rejected', respondedAt: new Date() },
      include: REQUEST_INCLUDE,
    });

    return { request: friendRequest(updated, me.id) };
  });

  /** 보낸 요청 취소(발신자 본인만). */
  app.delete('/friends/requests/:id', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await app.prisma.friendship.findUnique({ where: { id } });
    // 남의 요청 ID 를 넣어봐도 존재 여부조차 알 수 없게 404 로 통일한다.
    if (!row || row.requesterId !== me.id) {
      throw notFound('REQUEST_NOT_FOUND', '친구 요청을 찾을 수 없습니다.');
    }
    if (row.status !== 'pending') {
      throw conflict('REQUEST_NOT_PENDING', '이미 처리된 요청입니다.');
    }

    await app.prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'cancelled', respondedAt: new Date() },
    });

    return { ok: true };
  });

  app.get('/friends', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);

    const rows = await app.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: me.id }, { addresseeId: me.id }],
      },
      include: REQUEST_INCLUDE,
      orderBy: { respondedAt: 'desc' },
    });

    // 차단 상대는 친구 목록에서 감춘다. 관계 행 자체는 남겨 둔다
    // (차단 해제 시 친구 관계가 그대로 복구되는 편이 사용자 기대에 맞는다).
    const blocks = await app.prisma.block.findMany({
      where: { OR: [{ blockerId: me.id }, { blockedId: me.id }] },
      select: { blockerId: true, blockedId: true },
    });
    const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));

    const friends = rows
      .map((row) => (row.requesterId === me.id ? row.addressee : row.requester))
      .filter((user) => !hidden.has(user.id))
      .map(publicUser);

    return { friends };
  });

  app.delete('/friends/:userId', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { userId } = parseOrThrow(z.object({ userId: uuidSchema }), request.params);

    const deleted = await app.prisma.friendship.deleteMany({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: me.id, addresseeId: userId },
          { requesterId: userId, addresseeId: me.id },
        ],
      },
    });

    if (deleted.count === 0) {
      throw notFound('FRIENDSHIP_NOT_FOUND', '친구 관계를 찾을 수 없습니다.');
    }

    // 친구가 아니게 된 순간부터 예약된 알람은 규칙상 울리면 안 된다.
    // 발화 직전 재검증에서도 걸리지만, 여기서 미리 정리해 두면 취소 푸시를 즉시 보낼 수 있다.
    await app.prisma.alarm.updateMany({
      where: {
        status: 'scheduled',
        OR: [
          { senderId: me.id, receiverId: userId },
          { senderId: userId, receiverId: me.id },
        ],
      },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    return { ok: true };
  });
};

async function findFriendshipBetween(prisma: Db, a: string, b: string) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  });
}

async function loadPendingRequestForAddressee(prisma: Db, id: string, meId: string) {
  const row = await prisma.friendship.findUnique({ where: { id } });
  // 수신자가 아니면 404. 403 을 주면 "그 요청은 존재한다"는 정보가 새어 나간다.
  if (!row || row.addresseeId !== meId) {
    throw notFound('REQUEST_NOT_FOUND', '친구 요청을 찾을 수 없습니다.');
  }
  if (row.status !== 'pending') {
    throw conflict('REQUEST_NOT_PENDING', '이미 처리된 요청입니다.');
  }
  return row;
}

export default friendsRoutes;
