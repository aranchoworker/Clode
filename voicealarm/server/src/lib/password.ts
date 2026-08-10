import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id. 파라미터는 OWASP Password Storage Cheat Sheet 의 권장값(19MiB / t=2 / p=1)을 따른다.
 * 테스트에서는 메모리 비용을 낮춘다 — 안 그러면 유저 몇 명 만드는 테스트가 수 초씩 걸린다.
 */
const isTest = process.env.NODE_ENV === 'test';

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: isTest ? 8192 : 19456,
  timeCost: isTest ? 1 : 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain, OPTIONS);
  } catch {
    // 해시 포맷이 깨졌거나 알고리즘이 다른 경우. 예외를 밖으로 던지면
    // "로그인 실패"와 "서버 오류"가 섞이므로 여기서 false 로 흡수한다.
    return false;
  }
}
