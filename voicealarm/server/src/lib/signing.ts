import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * 로컬 스토리지용 서명 URL 토큰.
 *
 * S3 의 presigned URL 과 같은 성질을 갖게 만든다: 만료 시각과 허용 동작이 토큰 안에
 * 박혀 있고, 서명이 없으면 아무 파일에도 접근할 수 없다.
 * 개발 단계라고 인증을 느슨하게 두면, 그 상태가 그대로 배포되는 일이 실제로 잦다.
 */

export type StorageTokenPayload = {
  /** 대상 오브젝트 키 */
  key: string;
  /** 'up' = 업로드, 'dn' = 다운로드. 업로드 토큰으로 다운로드가 되면 안 된다. */
  purpose: 'up' | 'dn';
  /** 만료 (epoch seconds) */
  exp: number;
  /** 업로드 시 허용 최대 바이트 */
  max?: number;
};

/**
 * 서명 키는 JWT_SECRET 에서 파생한다.
 * 환경변수를 하나 더 요구하면 설정 실수가 늘고, 실수의 결과가 "서명 없는 URL"이다.
 * 용도별로 다른 문자열을 섞어 JWT 서명과 키가 겹치지 않게 한다.
 */
function signingKey(): Buffer {
  return createHmac('sha256', env().JWT_SECRET).update('voicealarm/storage-url/v1').digest();
}

function encode(payload: StorageTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

export function createStorageToken(payload: StorageTokenPayload): string {
  const body = encode(payload);
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; payload: StorageTokenPayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

export function verifyStorageToken(token: string): VerifyResult {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return { ok: false, reason: 'MALFORMED' };

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  // 길이가 다르면 timingSafeEqual 이 던진다. 길이 비교 자체는 비밀이 아니다.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  let payload: StorageTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }

  if (typeof payload.key !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: 'EXPIRED' };
  }

  return { ok: true, payload };
}
