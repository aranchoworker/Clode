import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    // 쿼리 로그에는 파라미터가 실려 나갈 수 있다(= 비밀번호 해시, 푸시 토큰).
    // 운영에서는 warn/error 만 남긴다.
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = null;
}
