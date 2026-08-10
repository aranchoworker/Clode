import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { publicUser } from '../lib/serialize.js';
import { parseOrThrow, userIdSchema, uuidSchema } from '../lib/validation.js';
import { currentUser } from '../plugins/auth.js';
import { recordAlarmEvent } from '../services/push.js';

const USER_SELECT = { id: true, userId: true, displayName: true } as const;

const createBlockBody = z.object({ target_user_id: userIdSchema });
const userIdParam = z.object({ userId: uuidSchema });

const blocksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/blocks', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);

    const rows = await app.prisma.block.findMany({
      where: { blockerId: me.id },
      include: { blocked: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      blocks: rows.map((row) => ({
        user: publicUser(row.blocked),
        created_at: row.createdAt.toISOString(),
      })),
    };
  });

  /**
   * 차단. 스펙의 요구는 세 가지가 한 번에 일어나는 것이다.
   *   1) 차단 기록 생성
   *   2) 예약된 알람을 blocked 로 전환
   *   3) 수신 기기에 취소 푸시
   *
   * 1)과 2)는 한 트랜잭션으로 묶는다. 중간에 실패해서 "차단은 됐는데 예약 알람은 살아 있는"
   * 상태가 남으면 안 되기 때문이다. 3)은 외부 호출이라 트랜잭션 밖에서 처리한다
   * (실패해도 발화 직전 재검증이 최종 방어선으로 남는다).
   */
  app.post('/blocks', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = currentUser(request);
    const body = parseOrThrow(createBlockBody, request.body);

    const target = await app.prisma.user.findFirst({
      where: { userId: body.target_user_id, deletedAt: null },
      select: USER_SELECT,
    });
    if (!target) {
      throw notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
    }
    if (target.id === me.id) {
      throw badRequest('SELF_BLOCK', '자기 자신은 차단할 수 없습니다.');
    }

    const cancelledAlarms = await app.prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId: me.id, blockedId: target.id } },
        create: { blockerId: me.id, blockedId: target.id },
        update: {},
      });

      // 차단 효과는 상호적이므로 양방향 예약 알람을 모두 막는다.
      // (내가 상대에게 보내 둔 알람도 더 이상 울려선 안 된다.)
      const affected = await tx.alarm.findMany({
        where: {
          status: 'scheduled',
          OR: [
            { senderId: target.id, receiverId: me.id },
            { senderId: me.id, receiverId: target.id },
          ],
        },
        select: { id: true, receiverId: true },
      });

      if (affected.length > 0) {
        await tx.alarm.updateMany({
          where: { id: { in: affected.map((a) => a.id) } },
          data: { status: 'blocked', cancelledAt: new Date() },
        });
        for (const alarm of affected) {
          await recordAlarmEvent(tx, alarm.id, 'blocked', { blockerId: me.id });
        }
      }

      return affected;
    });

    for (const alarm of cancelledAlarms) {
      await app.push.sendToUser(alarm.receiverId, {
        type: 'alarm.cancelled',
        alarmId: alarm.id,
        reason: 'blocked',
      });
    }

    reply.code(201);
    return {
      block: { user: publicUser(target) },
      cancelled_alarm_count: cancelledAlarms.length,
    };
  });

  /**
   * 차단 해제. 이미 blocked 로 전환된 알람은 되살리지 않는다.
   * 지나간 시각으로 알람이 복구되면 해제하자마자 과거 알람이 한꺼번에 울리는
   * 사고가 나고, 사용자가 기대하는 동작도 아니다.
   */
  app.delete('/blocks/:userId', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { userId } = parseOrThrow(userIdParam, request.params);

    const deleted = await app.prisma.block.deleteMany({
      where: { blockerId: me.id, blockedId: userId },
    });

    if (deleted.count === 0) {
      throw notFound('BLOCK_NOT_FOUND', '차단 기록을 찾을 수 없습니다.');
    }

    return { ok: true };
  });
};

export default blocksRoutes;
