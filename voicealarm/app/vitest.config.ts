import { defineConfig } from 'vitest/config';

/**
 * 순수 TypeScript 모듈(API 클라이언트, i18n, 에러 매핑)만 테스트한다.
 * 컴포넌트 렌더 테스트는 jest-expo 프리셋이 필요해서 별도 단계로 둔다 —
 * 현재 자동으로 검증되는 범위를 README 에 명시해 두었다.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
