import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import { translate } from '../src/i18n';
import { describeError } from '../src/lib/errorMessage';

describe('에러 표시', () => {
  it('알려진 서버 코드는 화면 언어로 옮긴다', () => {
    const described = describeError(new ApiError(401, 'INVALID_CREDENTIALS', '한국어 서버 문구'));

    expect(described).toEqual({ key: 'auth.error.invalidCredentials' });
    // 서버 문구가 아니라 앱의 번역이 쓰인다
    expect(translate('en', 'auth.error.invalidCredentials')).toBe('Incorrect username or password.');
  });

  it('매핑이 없는 코드는 서버 문구로 폴백한다', () => {
    const described = describeError(new ApiError(403, 'SOME_NEW_CODE', '서버가 준 설명'));
    expect(described).toEqual({ text: '서버가 준 설명' });
  });

  it('ApiError 가 아닌 예외는 일반 오류로 처리한다', () => {
    expect(describeError(new Error('boom'))).toEqual({ key: 'common.error.unknown' });
    expect(describeError('문자열')).toEqual({ key: 'common.error.unknown' });
  });

  it('네트워크 오류는 연결 안내 문구로 간다', () => {
    const error = new ApiError(0, 'NETWORK_ERROR', '네트워크에 연결할 수 없습니다.');
    expect(describeError(error)).toEqual({ key: 'common.error.network' });
  });
});
