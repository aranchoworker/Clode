import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ko } from '../src/i18n/ko';
import { resolveLocale, translate } from '../src/i18n';

describe('i18n', () => {
  it('두 언어의 키 집합이 동일하다', () => {
    // en.ts 는 Record<TranslationKey, string> 이라 타입으로도 걸리지만,
    // 런타임에서도 확인해 둔다(오탈자 키가 추가되는 경우 대비).
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('빈 문자열 번역이 없다', () => {
    for (const [key, value] of Object.entries({ ...ko, ...en })) {
      expect(value.length, `빈 번역: ${key}`).toBeGreaterThan(0);
    }
  });

  it('자리표시자를 치환한다', () => {
    expect(translate('ko', 'friends.blocked.done', { name: '보라' })).toBe('보라 님을 차단했습니다.');
    expect(translate('en', 'friends.blocked.alarmsCancelled', { count: 3 })).toContain('3');
  });

  it('자리표시자를 안 넘기면 원문을 그대로 둔다 (빈칸으로 만들지 않는다)', () => {
    expect(translate('ko', 'friends.blocked.done')).toContain('{name}');
  });

  it('양쪽 언어의 자리표시자가 같아야 한다', () => {
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of Object.keys(ko) as (keyof typeof ko)[]) {
      expect(placeholders(en[key]), `자리표시자 불일치: ${key}`).toEqual(placeholders(ko[key]));
    }
  });

  it('기기 언어를 지원 언어로 좁힌다', () => {
    expect(resolveLocale(['ko-KR'])).toBe('ko');
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['fr-FR', 'en-GB'])).toBe('en');
    // 지원하지 않는 언어만 있으면 한국어로 떨어진다
    expect(resolveLocale(['ja-JP'])).toBe('ko');
    expect(resolveLocale([])).toBe('ko');
  });
});
