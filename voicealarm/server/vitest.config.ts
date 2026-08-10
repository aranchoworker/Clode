import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 테스트 파일들이 같은 DB 를 공유하므로 병렬로 돌리면 서로의 데이터를 지운다.
    // 규모가 커지면 파일별 스키마 분리로 바꾼다.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
