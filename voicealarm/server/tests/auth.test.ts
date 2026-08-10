import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, prisma, resetDb, signUp } from './helpers.js';

describe('인증', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('가입 후 토큰이 발급되고 /auth/me 로 본인 확인이 된다', async () => {
    const user = await signUp(app, 'alice');

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user.user_id).toBe('alice');
  });

  it('비밀번호는 평문으로 저장되지 않는다', async () => {
    const user = await signUp(app, 'alice');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(row.passwordHash).not.toContain('password123');
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('아이디는 대소문자를 구분하지 않는다 (중복 가입 차단)', async () => {
    await signUp(app, 'alice');

    const dup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { user_id: 'ALICE', password: 'password123', display_name: '앨리스' },
    });

    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USER_ID_TAKEN');
  });

  it('8자 미만 비밀번호는 거부된다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { user_id: 'shorty', password: 'short', display_name: '숏' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('없는 아이디와 틀린 비밀번호는 같은 응답을 준다 (계정 존재 여부 은닉)', async () => {
    await signUp(app, 'alice');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { user_id: 'alice', password: 'wrongpassword' },
    });
    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { user_id: 'nobody', password: 'wrongpassword' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchUser.json());
  });

  it('로그인 실패가 임계치를 넘으면 잠긴다', async () => {
    await signUp(app, 'alice');

    for (let i = 0; i < 6; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { user_id: 'alice', password: 'wrongpassword' },
      });
    }

    // 잠긴 뒤에는 비밀번호가 맞아도 429
    const correct = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { user_id: 'alice', password: 'password123' },
    });

    expect(correct.statusCode).toBe(429);
    expect(correct.json().error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  });

  it('refresh 토큰은 회전되고, 이전 토큰은 재사용할 수 없다', async () => {
    const user = await signUp(app, 'alice');

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: user.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json().refresh_token;
    expect(rotated).not.toBe(user.refreshToken);

    // 이미 회전된(폐기된) 토큰 재사용 → 탈취로 간주
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: user.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('REFRESH_TOKEN_REUSED');

    // 재사용 감지 시 계열 전체가 폐기되므로 방금 받은 새 토큰도 무효
    const afterBreach = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: rotated },
    });
    expect(afterBreach.statusCode).toBe(401);
  });

  it('로그아웃하면 refresh 토큰이 폐기된다', async () => {
    const user = await signUp(app, 'alice');

    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refresh_token: user.refreshToken },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: user.refreshToken },
    });

    expect(response.statusCode).toBe(401);
  });

  it('토큰 없이 보호된 엔드포인트에 접근하면 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/friends' });
    expect(response.statusCode).toBe(401);
  });
});
