import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { alarm as serializeAlarm } from '../lib/serialize.js';
import { parseOrThrow, userIdSchema, uuidSchema } from '../lib/validation.js';
import { currentUser } from '../plugins/auth.js';
import { evaluateSendEligibility, type DenyReason } from '../services/relationships.js';
import { recordAlarmEvent } from '../services/push.js';

const USER_SELECT = { id: true, userId: true, displayName: true } as const;
const ALARM_INCLUDE = {
  sender: { select: USER_SELECT },
  receiver: { select: USER_SELECT },
  voiceMessage: { select: { id: true, durationMs: true } },
} as const;

const createAlarmBody = z.object({
  receiver_user_id: userIdSchema,
  voice_message_id: uuidSchema,
  scheduled_at: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, '올바른 타임존이 아닙니다.'),
  title: z.string().trim().max(100).optional(),
});

const listQuery = z.object({ role: z.enum(['sent', 'received']).default('received') });
const idParam = z.object({ id: uuidSchema });
const ackBody = z.object({ played: z.boolean().default(true) }).default({});

/**
 * 알람 파이프라인.
 *
 * 이 모듈의 라우트는 친구/차단 판정을 직접 하지 않는다. 전부
 * services/relationships.ts 의 evaluateSendEligibility 를 통해서만 한다.
 * 예약(POST /alarms)과 발화 직전 재검증(GET /alarms/:id/validity)이 다른 조건을
 * 쓰게 되는 순간 "차단했는데 울리는" 버그가 생기므로, 두 경로가 반드시 같은
 * 함수를 호출하도록 강제한다.
 */
const alarmsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/alarms', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = currentUser(request);
    const body = parseOrThrow(createAlarmBody, request.body);

    const receiver = await app.prisma.user.findFirst({
      where: { userId: body.receiver_user_id, deletedAt: null },
      select: USER_SELECT,
    });
    if (!receiver) {
      throw notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
    }

    // 친구/차단 검증. 예약 시점 판정이지만, 발화 직전에도 같은 함수로 다시 확인한다.
    const eligibility = await evaluateSendEligibility(app.prisma, me.id, receiver.id);
    if (!eligibility.allowed) {
      throw denyReasonToError(eligibility.reason);
    }

    const voiceMessage = await app.prisma.voiceMessage.findUnique({
      where: { id: body.voice_message_id },
      select: { id: true, ownerId: true, durationMs: true },
    });
    // 소유자가 아니면 존재 여부를 숨긴다 — 남의 음성 메시지 ID 를 추측해도 알 수 없게.
    if (!voiceMessage || voiceMessage.ownerId !== me.id) {
      throw notFound('VOICE_MESSAGE_NOT_FOUND', '음성 메시지를 찾을 수 없습니다.');
    }

    const scheduledAt = new Date(body.scheduled_at);
    const minScheduledAt = Date.now() + env().MIN_ALARM_LEAD_SEC * 1000;
    if (scheduledAt.getTime() < minScheduledAt) {
      throw badRequest(
        'SCHEDULED_AT_TOO_SOON',
        `알람은 최소 ${env().MIN_ALARM_LEAD_SEC}초 이후로만 예약할 수 있습니다.`,
        { min_scheduled_at: new Date(minScheduledAt).toISOString() },
      );
    }

    const created = await app.prisma.alarm.create({
      data: {
        senderId: me.id,
        receiverId: receiver.id,
        voiceMessageId: voiceMessage.id,
        scheduledAt,
        timezone: body.timezone,
        title: body.title,
      },
      include: ALARM_INCLUDE,
    });

    await recordAlarmEvent(app.prisma, created.id, 'scheduled', {
      scheduledAt: scheduledAt.toISOString(),
    });

    // 수신 기기에 조용한 데이터 푸시. 기기는 이걸 받고 음성 파일을 미리 내려받아
    // OS 로컬 알람으로 등록한다 — 발화 시점에 네트워크가 필요 없게 만드는 핵심 경로다.
    await app.push.sendToUser(receiver.id, { type: 'alarm.scheduled', alarmId: created.id });

    reply.code(201);
    return { alarm: serializeAlarm(created) };
  });

  app.get('/alarms', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { role } = parseOrThrow(listQuery, request.query);

    const rows = await app.prisma.alarm.findMany({
      where: role === 'sent' ? { senderId: me.id } : { receiverId: me.id },
      include: ALARM_INCLUDE,
      orderBy: { scheduledAt: 'asc' },
    });

    return { alarms: rows.map(serializeAlarm) };
  });

  /**
   * 알람 상세. 수신 기기가 푸시를 받은 뒤 이 엔드포인트로 전체 정보를 가져온다.
   * 푸시 페이로드에는 alarm_id 만 담기 때문에(만료된 액세스 토큰과 무관하게 항상
   * 최신 정보를 받기 위해), 실제 내용은 여기서 매번 새로 읽는다.
   */
  app.get('/alarms/:id', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await loadAlarmForParticipant(app.prisma, id, me.id, ALARM_INCLUDE);
    return { alarm: serializeAlarm(row) };
  });

  /** 발신자 취소. */
  app.delete('/alarms/:id', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await app.prisma.alarm.findUnique({ where: { id } });
    if (!row || row.senderId !== me.id) {
      throw notFound('ALARM_NOT_FOUND', '알람을 찾을 수 없습니다.');
    }
    if (row.status !== 'scheduled') {
      throw conflict('ALARM_NOT_CANCELLABLE', '이미 처리된 알람입니다.');
    }

    await app.prisma.alarm.update({
      where: { id: row.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await recordAlarmEvent(app.prisma, row.id, 'cancelled', { by: 'sender' });
    await app.push.sendToUser(row.receiverId, {
      type: 'alarm.cancelled',
      alarmId: row.id,
      reason: 'cancelled',
    });

    return { ok: true };
  });

  /**
   * 발화 직전 재검증. 수신 기기가 로컬 알람이 울리기 직전 호출한다.
   *
   * 예약 시점과 동일하게 evaluateSendEligibility 하나만 쓴다. 판정이 실패하면
   * 여기서 알람 상태도 함께 정리한다 — 그래야 이 알람에 대한 다음 validity 호출이나
   * 목록 조회가 "왜 막혔는지"를 그대로 보여준다.
   */
  app.get('/alarms/:id/validity', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const row = await app.prisma.alarm.findUnique({ where: { id } });
    // 수신자만 호출할 수 있다. 발신자·제3자에게는 존재 자체를 숨긴다.
    if (!row || row.receiverId !== me.id) {
      throw notFound('ALARM_NOT_FOUND', '알람을 찾을 수 없습니다.');
    }

    if (row.status !== 'scheduled') {
      return { valid: false, reason: statusToValidityReason(row.status) };
    }

    const eligibility = await evaluateSendEligibility(app.prisma, row.senderId, row.receiverId);
    if (eligibility.allowed) {
      return { valid: true, reason: null };
    }

    const nextStatus = eligibility.reason === 'BLOCKED' ? 'blocked' : 'cancelled';
    await app.prisma.alarm.update({
      where: { id: row.id },
      data: { status: nextStatus, cancelledAt: new Date() },
    });
    await recordAlarmEvent(app.prisma, row.id, nextStatus, { source: 'validity_check' });

    return { valid: false, reason: nextStatus === 'blocked' ? 'blocked' : 'not_friends' };
  });

  /** 발화 완료 보고. */
  app.post('/alarms/:id/ack', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(ackBody, request.body ?? {});

    const row = await app.prisma.alarm.findUnique({ where: { id } });
    if (!row || row.receiverId !== me.id) {
      throw notFound('ALARM_NOT_FOUND', '알람을 찾을 수 없습니다.');
    }
    if (row.status !== 'scheduled') {
      // 이미 blocked/cancelled 로 정리된 알람이 발화 직전 재검증을 건너뛰고 ack 만
      // 호출하는 경우(클라이언트 버그·오프라인 등)를 위한 방어선. 성공으로 위장하지 않는다.
      throw conflict('ALARM_NOT_ACTIVE', '이미 처리된 알람입니다.');
    }

    await app.prisma.alarm.update({
      where: { id: row.id },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
    await recordAlarmEvent(app.prisma, row.id, 'delivered', { played: body.played });

    return { ok: true };
  });
};

async function loadAlarmForParticipant(
  prisma: Parameters<FastifyPluginAsync>[0]['prisma'],
  id: string,
  viewerId: string,
  include: typeof ALARM_INCLUDE,
) {
  const row = await prisma.alarm.findUnique({ where: { id }, include });
  if (!row || (row.senderId !== viewerId && row.receiverId !== viewerId)) {
    throw notFound('ALARM_NOT_FOUND', '알람을 찾을 수 없습니다.');
  }
  return row;
}

function denyReasonToError(reason: DenyReason) {
  if (reason === 'RECEIVER_NOT_FOUND') {
    return notFound('USER_NOT_FOUND', '해당 아이디의 사용자를 찾을 수 없습니다.');
  }
  if (reason === 'SELF') {
    return badRequest('SELF_TARGET', '자기 자신에게는 보낼 수 없습니다.');
  }
  return forbidden(reason, reason === 'BLOCKED' ? '차단된 상대에게는 알람을 보낼 수 없습니다.' : '친구 요청이 수락되지 않아 알람을 보낼 수 없습니다.');
}

function statusToValidityReason(status: string): string {
  switch (status) {
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'cancelled';
    case 'delivered':
      return 'already_delivered';
    case 'failed':
      return 'failed';
    default:
      return 'cancelled';
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export default alarmsRoutes;
