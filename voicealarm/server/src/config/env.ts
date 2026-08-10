import { z } from 'zod';

/**
 * 환경변수는 여기 한 곳에서만 읽는다. 부팅 시점에 검증해서, 시크릿이 빠진 채로
 * 서버가 뜨는 상황(= 런타임에 500 으로 터지는 상황)을 만들지 않는다.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),

  /// 최소 32자. 짧은 시크릿으로 HS256 을 쓰면 사실상 무의미하므로 부팅을 막는다.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('voicealarm'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),

  /// 로그인 실패 몇 회부터 지수 백오프를 걸지
  LOGIN_FAIL_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_BASE_SEC: z.coerce.number().int().positive().default(30),
  LOGIN_LOCK_MAX_SEC: z.coerce.number().int().positive().default(60 * 60),

  CORS_ORIGIN: z.string().default('*'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`환경변수 설정이 올바르지 않습니다:\n${detail}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
