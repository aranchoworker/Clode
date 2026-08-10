import { createReadStream } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { verifyStorageToken } from '../lib/signing.js';
import { parseOrThrow } from '../lib/validation.js';
import { LocalDiskStorage } from '../services/storage/localDisk.js';

const query = z.object({ key: z.string().min(1), token: z.string().min(1) });

/**
 * 로컬 스토리지 드라이버의 업로드/다운로드 엔드포인트.
 *
 * S3 로 옮기면 이 라우트는 통째로 사라진다 — 클라이언트가 S3 로 직접 올리고 받기 때문이다.
 * 그래서 여기서는 액세스 토큰(로그인)을 요구하지 않고, 서명 URL 만으로 접근을 통제한다.
 * S3 presigned URL 과 동일한 보안 모델을 개발 환경에서도 그대로 재현하기 위해서다.
 */
const storageRoutes: FastifyPluginAsync = async (app) => {
  const storage = app.storage;
  if (!(storage instanceof LocalDiskStorage)) return;

  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.put('/storage/upload', async (request, reply) => {
    const { key, token } = parseOrThrow(query, request.query);
    const verified = verifyStorageToken(token);

    if (!verified.ok) {
      throw forbidden('INVALID_UPLOAD_TOKEN', tokenMessage(verified.reason));
    }
    // 토큰에 박힌 키와 요청한 키가 다르면 다른 사람 파일을 덮어쓰려는 시도다.
    if (verified.payload.key !== key || verified.payload.purpose !== 'up') {
      throw forbidden('INVALID_UPLOAD_TOKEN', '업로드 토큰이 이 경로에 유효하지 않습니다.');
    }

    const maxBytes = verified.payload.max ?? env().MAX_UPLOAD_BYTES;

    try {
      const written = await storage.writeStream(key, request.raw, maxBytes);
      reply.code(201);
      return { key, size: written };
    } catch (error) {
      if (error instanceof Error && error.message === 'UPLOAD_TOO_LARGE') {
        throw badRequest('UPLOAD_TOO_LARGE', `파일이 너무 큽니다. 최대 ${maxBytes} 바이트입니다.`);
      }
      throw error;
    }
  });

  app.get('/storage/download', async (request, reply) => {
    const { key, token } = parseOrThrow(query, request.query);
    const verified = verifyStorageToken(token);

    if (!verified.ok) {
      throw forbidden('INVALID_DOWNLOAD_TOKEN', tokenMessage(verified.reason));
    }
    if (verified.payload.key !== key || verified.payload.purpose !== 'dn') {
      throw forbidden('INVALID_DOWNLOAD_TOKEN', '다운로드 토큰이 이 경로에 유효하지 않습니다.');
    }

    if (!(await storage.exists(key))) {
      throw notFound('FILE_NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    reply.header('content-type', contentTypeFor(key));
    reply.header('content-length', String(await storage.size(key)));
    // 서명 URL 은 만료가 있으므로 중간 캐시에 남으면 안 된다.
    reply.header('cache-control', 'private, no-store');
    return reply.send(createReadStream(storage.resolveReadPath(key)));
  });
};

function tokenMessage(reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED'): string {
  return reason === 'EXPIRED' ? 'URL 이 만료되었습니다.' : '유효하지 않은 URL 입니다.';
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.caf')) return 'audio/x-caf';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

export default storageRoutes;
