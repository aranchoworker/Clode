import { getLocales } from 'expo-localization';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { resolveLocale, translate, type Locale, type TranslationKey } from './index';

type I18nValue = {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale?: Locale }) {
  const value = useMemo<I18nValue>(() => {
    // 기기 언어를 따른다. 앱 내 언어 전환은 아직 없지만, locale 을 prop 으로 주입할 수
    // 있게 해 둬서 설정 화면이 생기면 바로 붙일 수 있다.
    const active = locale ?? resolveLocale(getLocales().map((entry) => entry.languageTag));
    return {
      locale: active,
      t: (key, params) => translate(active, key, params),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
