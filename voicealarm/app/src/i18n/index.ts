import { ko, type TranslationKey } from './ko';
import { en } from './en';

export type Locale = 'ko' | 'en';
export type { TranslationKey };

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { ko, en };

export const DEFAULT_LOCALE: Locale = 'ko';

/** expo-localization 이 주는 태그("ko-KR", "en-US")를 지원 언어로 좁힌다. */
export function resolveLocale(languageTags: readonly string[]): Locale {
  for (const tag of languageTags) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ko' || base === 'en') return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * {name} 형태의 자리표시자를 치환한다.
 * 키가 없으면 키 자체를 반환한다 — 화면이 빈칸으로 뜨는 것보다 원인을 찾기 쉽다.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
