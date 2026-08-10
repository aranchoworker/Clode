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

  /// 클라이언트가 접근하는 서버 주소. 서명 URL 을 만들 때 쓰므로 실제 도달 가능한 값이어야 한다.
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),

  /// 녹음 제한. 30초는 iOS 알림음 상한에서 온 값이라 늘릴 수 없다.
  MAX_RECORDING_MS: z.coerce.number().int().positive().default(30_000),
  /// 프레임 경계 때문에 실제 파일이 30초를 아주 살짝 넘을 수 있어 여유를 둔다.
  RECORDING_DURATION_TOLERANCE_MS: z.coerce.number().int().nonnegative().default(500),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(10 * 60),
  DOWNLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(10 * 60),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  /// 'noop' 는 큐잉만 하고 실제로 보내지 않는다(테스트 기본값). 실 발송은 'fcm'.
  PUSH_DRIVER: z.enum(['noop', 'fcm']).default('noop'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./firebase-service-account.json'),

  /// 알람 발화 시각 제한. 예약 시점에서 이보다 가까운 미래는 남용/실수 방지를 위해 거부한다.
  MIN_ALARM_LEAD_SEC: z.coerce.number().int().nonnegative().default(60),
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
