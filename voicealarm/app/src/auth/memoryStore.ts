import type { TokenStore, Tokens } from '../api/client';

/**
 * 메모리 토큰 저장소.
 *
 * 별도 파일로 분리한 이유: storage.ts 는 expo-secure-store 를 import 하는데,
 * 그건 네이티브 모듈이라 Node 에서 로드할 수 없다. 테스트가 SecureTokenStore 와
 * 같은 파일을 건드리는 순간 전체가 못 돌아간다.
 */
export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: Tokens | null = null) {}

  async load(): Promise<Tokens | null> {
    return this.tokens;
  }

  async save(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
