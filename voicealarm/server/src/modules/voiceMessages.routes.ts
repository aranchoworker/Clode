import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parseOrThrow, uuidSchema } from '../lib/validation.js';
import { currentUser } from '../plugins/auth.js';
import { AudioError, probeAudio, transcodeToCaf, withTempDir } from '../services/audio.js';

/**
 * 허용 업로드 포맷.
 *
 * 앱은 m4a(AAC)로 녹음한다. iOS 알림음은 이 포맷을 못 쓰므로 서버가 caf 로 한 벌 더 만든다.
 * 원본을 함께 보관하는 이유는 30초 초과분 재생(앱을 열었을 때)과 Android 재생 때문이다.
 */
const ALLOWED_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

const uploadUrlBody = z.object({
  mime_type: z.string().min(1),
});

const registerBody = z.object({
  storage_key: z.string().min(1).max(200),
});

const idParam = z.object({ id: uuidSchema });
const downloadQuery = z.object({ variant: z.enum(['original', 'ios']).default('original') });

const voiceMessagesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 1단계: 업로드 URL 발급.
   *
   * 키에 소유자 ID 를 박아 둔다. 2단계에서 클라이언트가 키를 되돌려 줄 때,
   * 그 키가 정말 이 사용자 것인지 별도 조회 없이 검증할 수 있다.
   */
  app.post('/voice-messages/upload-url', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const body = parseOrThrow(uploadUrlBody, request.body);

    const extension = ALLOWED_MIME[body.mime_type.toLowerCase()];
    if (!extension) {
      throw badRequest(
        'UNSUPPORTED_MIME_TYPE',
        `지원하지 않는 형식입니다: ${body.mime_type}`,
        { supported: Object.keys(ALLOWED_MIME) },
      );
    }

    const key = `voice/${me.id}/${randomUUID()}.${extension}`;
    const signed = await app.storage.createUploadUrl(key, {
      contentType: body.mime_type,
      maxBytes: env().MAX_UPLOAD_BYTES,
      expiresInSec: env().UPLOAD_URL_TTL_SEC,
    });

    return {
      storage_key: key,
      upload: {
        url: signed.url,
        method: signed.method,
        headers: signed.headers,
        expires_at: signed.expiresAt.toISOString(),
      },
      max_bytes: env().MAX_UPLOAD_BYTES,
      max_duration_ms: env().MAX_RECORDING_MS,
    };
  });

  /**
   * 2단계: 업로드 완료 등록.
   *
   * 클라이언트가 알려 주는 길이는 받지 않는다. 실제 파일을 ffprobe 로 재서 판단한다.
   * 30초 제한은 iOS 알림음 상한에서 온 것이고, 동시에 남용 방지 장치이기도 하다.
   */
  app.post('/voice-messages', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = currentUser(request);
    const { storage_key: key } = parseOrThrow(registerBody, request.body);

    // 키에 박힌 소유자와 요청자가 다르면 남의 업로드를 자기 것으로 등록하려는 시도다.
    if (!key.startsWith(`voice/${me.id}/`)) {
      throw forbidden('NOT_OWNER', '본인이 발급받은 업로드 경로가 아닙니다.');
    }
    if (!(await app.storage.exists(key))) {
      throw notFound('UPLOAD_NOT_FOUND', '업로드된 파일을 찾을 수 없습니다.');
    }

    const existing = await app.prisma.voiceMessage.findFirst({
      where: { storageKey: key },
      select: { id: true },
    });
    if (existing) {
      throw badRequest('ALREADY_REGISTERED', '이미 등록된 파일입니다.');
    }

    const size = await app.storage.size(key);
    if (size > env().MAX_UPLOAD_BYTES) {
      await app.storage.delete(key);
      throw badRequest('UPLOAD_TOO_LARGE', '파일이 너무 큽니다.');
    }

    const source = await app.storage.materialize(key);

    try {
      const probe = await probeAudio(source.path);
      const limit = env().MAX_RECORDING_MS + env().RECORDING_DURATION_TOLERANCE_MS;

      if (probe.durationMs > limit) {
        // 제한 초과 파일은 남겨 둘 이유가 없다. 바로 지운다.
        await app.storage.delete(key);
        throw badRequest(
          'RECORDING_TOO_LONG',
          `녹음은 최대 ${Math.round(env().MAX_RECORDING_MS / 1000)}초까지 가능합니다.`,
          { duration_ms: probe.durationMs, max_duration_ms: env().MAX_RECORDING_MS },
        );
      }
      if (probe.durationMs <= 0) {
        await app.storage.delete(key);
        throw badRequest('RECORDING_EMPTY', '녹음 길이가 0입니다.');
      }

      // iOS 알림음용 caf 를 함께 만든다. 여기서 실패하면 등록 자체를 실패시킨다 —
      // caf 없이 등록되면 Phase 4 에서 "iOS 에서만 조용한 알람"이 되고, 원인 추적이 어렵다.
      const cafKey = key.replace(/\.[^.]+$/, '') + '.caf';
      await withTempDir(async (dir) => {
        const cafPath = join(dir, 'sound.caf');
        await transcodeToCaf(source.path, cafPath);
        await app.storage.putFile(cafKey, cafPath, 'audio/x-caf');
      });

      const created = await app.prisma.voiceMessage.create({
        data: {
          ownerId: me.id,
          storageKey: key,
          durationMs: probe.durationMs,
          // 클라이언트가 신고한 값이 아니라 실제 파일에서 판단한 형식을 저장한다.
          mimeType: key.endsWith('.wav') ? 'audio/wav' : 'audio/mp4',
          iosCafKey: cafKey,
        },
        select: { id: true, durationMs: true, createdAt: true },
      });

      reply.code(201);
      return {
        voice_message: {
          id: created.id,
          duration_ms: created.durationMs,
          created_at: created.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof AudioError) {
        await app.storage.delete(key);
        throw badRequest('INVALID_AUDIO', '오디오 파일을 처리할 수 없습니다.', { cause: error.code });
      }
      throw error;
    } finally {
      await source.dispose();
    }
  });

  /**
   * 재생용 다운로드 URL.
   *
   * 접근 권한: 소유자(발신자) 또는 이 녹음이 붙은 알람의 수신자.
   * 그 외에는 404 로 응답한다 — 403 을 주면 "그 ID 는 존재한다"가 새어 나간다.
   */
  app.get('/voice-messages/:id/download-url', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const { variant } = parseOrThrow(downloadQuery, request.query);

    const voice = await app.prisma.voiceMessage.findUnique({
      where: { id },
      select: { id: true, ownerId: true, storageKey: true, iosCafKey: true, durationMs: true },
    });
    if (!voice) {
      throw notFound('VOICE_MESSAGE_NOT_FOUND', '음성 메시지를 찾을 수 없습니다.');
    }

    if (voice.ownerId !== me.id) {
      const linked = await app.prisma.alarm.findFirst({
        where: { voiceMessageId: voice.id, receiverId: me.id },
        select: { id: true },
      });
      if (!linked) {
        throw notFound('VOICE_MESSAGE_NOT_FOUND', '음성 메시지를 찾을 수 없습니다.');
      }
    }

    const key = variant === 'ios' ? voice.iosCafKey : voice.storageKey;
    if (!key) {
      throw notFound('VARIANT_NOT_AVAILABLE', '해당 형식의 파일이 없습니다.');
    }

    const signed = await app.storage.createDownloadUrl(key, env().DOWNLOAD_URL_TTL_SEC);

    return {
      url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
      duration_ms: voice.durationMs,
      variant,
    };
  });

  /** 아직 알람에 쓰이지 않은 녹음만 삭제할 수 있다(재녹음 취소용). */
  app.delete('/voice-messages/:id', { preHandler: app.requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = parseOrThrow(idParam, request.params);

    const voice = await app.prisma.voiceMessage.findUnique({
      where: { id },
      select: { id: true, ownerId: true, storageKey: true, iosCafKey: true },
    });
    if (!voice || voice.ownerId !== me.id) {
      throw notFound('VOICE_MESSAGE_NOT_FOUND', '음성 메시지를 찾을 수 없습니다.');
    }

    const usedBy = await app.prisma.alarm.count({ where: { voiceMessageId: voice.id } });
    if (usedBy > 0) {
      throw badRequest('VOICE_MESSAGE_IN_USE', '이미 알람에 사용된 녹음은 삭제할 수 없습니다.');
    }

    await app.prisma.voiceMessage.delete({ where: { id: voice.id } });
    await app.storage.delete(voice.storageKey);
    if (voice.iosCafKey) await app.storage.delete(voice.iosCafKey);

    return { ok: true };
  });
};

export default voiceMessagesRoutes;
