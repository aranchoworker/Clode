import { ApiError } from '../api/client';
import type { TranslationKey } from '../i18n';

/**
 * 서버 에러 코드를 화면 문구 키로 옮긴다.
 *
 * 서버가 주는 message 를 그대로 띄우지 않는 이유:
 * 서버 문구는 한국어로 고정돼 있고, 앱은 기기 언어를 따르기 때문이다.
 * 매핑이 없는 코드만 서버 문구로 폴백한다.
 */
const CODE_TO_KEY: Record<string, TranslationKey> = {
  NETWORK_ERROR: 'common.error.network',
  INVALID_CREDENTIALS: 'auth.error.invalidCredentials',
  USER_ID_TAKEN: 'auth.error.userIdTaken',
  TOO_MANY_LOGIN_ATTEMPTS: 'auth.error.tooManyAttempts',
  VALIDATION_ERROR: 'auth.error.validation',
  USER_NOT_FOUND: 'search.notFound',
};

export type DisplayableError = { key: TranslationKey } | { text: string };

export function describeError(error: unknown): DisplayableError {
  if (error instanceof ApiError) {
    const key = CODE_TO_KEY[error.code];
    if (key) return { key };
    return { text: error.message };
  }
  return { key: 'common.error.unknown' };
}
