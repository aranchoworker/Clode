import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, becomeFriends, createTestApp, prisma, resetDb, signUp, type TestUser } from './helpers.js';

const run = promisify(execFile);

/**
 * 녹음 업로드 파이프라인 테스트.
 *
 * 진짜 오디오 파일을 ffmpeg 로 만들어서 넣는다. 더미 바이트로는 "30초 제한"이나
 * "caf 변환"이 동작하는지 전혀 확인할 수 없기 때문이다.
 */
describe('음성 메시지 업로드', () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let workDir: string;

  /** ffmpeg 로 지정한 길이의 m4a 를 만든다. */
  async function makeRecording(seconds: number, name: string): Promise<Buffer> {
    const path = join(workDir, name);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-ac', '1',
      path,
    ]);
    return readFile(path);
  }

  /** 업로드 URL 발급 → PUT 업로드까지. 등록(POST /voice-messages)은 하지 않는다. */
  async function upload(user: TestUser, body: Buffer) {
    const issued = await app.inject({
      method: 'POST',
      url: '/voice-messages/upload-url',
      headers: auth(user),
      payload: { mime_type: 'audio/mp4' },
    });
    expect(issued.statusCode).toBe(200);
    const { storage_key, upload } = issued.json();

    // 발급된 URL 을 그대로 쓴다(경로·토큰이 실제로 유효한지 확인하기 위해).
    const target = new URL(upload.url);
    const put = await app.inject({
      method: 'PUT',
      url: target.pathname + target.search,
      headers: { 'content-type': 'audio/mp4' },
      payload: body,
    });

    return { storageKey: storage_key as string, put, uploadUrl: upload.url as string };
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    workDir = await mkdtemp(join(tmpdir(), 'voicealarm-test-'));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb();
    alice = await signUp(app);
  });

  it('업로드 → 등록까지 성공하고 iOS용 caf 가 함께 만들어진다', async () => {
    const { storageKey, put } = await upload(alice, await makeRecording(3, 'ok.m4a'));
    expect(put.statusCode).toBe(201);

    const registered = await app.inject({
      method: 'POST',
      url: '/voice-messages',
      headers: auth(alice),
      payload: { storage_key: storageKey },
    });

    expect(registered.statusCode).toBe(201);
    const voice = registered.json().voice_message;
    // 클라이언트가 알려 준 값이 아니라 서버가 실제 파일에서 잰 길이다
    expect(voice.duration_ms).toBeGreaterThan(2_500);
    expect(voice.duration_ms).toBeLessThan(3_500);

    const row = await prisma.voiceMessage.findUniqueOrThrow({ where: { id: voice.id } });
    expect(row.iosCafKey).toMatch(/\.caf$/);
    expect(await app.storage.exists(row.iosCafKey!)).toBe(true);
  });

  it('30초를 넘는 녹음은 거부하고 업로드된 파일도 지운다', async () => {
    const { storageKey } = await upload(alice, await makeRecording(35, 'long.m4a'));

    const registered = await app.inject({
      method: 'POST',
      url: '/voice-messages',
      headers: auth(alice),
      payload: { storage_key: storageKey },
    });

    expect(registered.statusCode).toBe(400);
    expect(registered.json().error.code).toBe('RECORDING_TOO_LONG');

    // 거부된 파일이 스토리지에 남아 있으면 용량만 잡아먹는다
    expect(await app.storage.exists(storageKey)).toBe(false);
    expect(await prisma.voiceMessage.count()).toBe(0);
  });

  it('오디오가 아닌 파일은 거부한다', async () => {
    const { storageKey } = await upload(alice, Buffer.from('이건 오디오가 아닙니다'));

    const registered = await app.inject({
      method: 'POST',
      url: '/voice-messages',
      headers: auth(alice),
      payload: { storage_key: storageKey },
    });

    expect(registered.statusCode).toBe(400);
    expect(registered.json().error.code).toBe('INVALID_AUDIO');
    expect(await app.storage.exists(storageKey)).toBe(false);
  });

  it('남이 발급받은 경로로는 등록할 수 없다', async () => {
    const bob = await signUp(app);
    const { storageKey } = await upload(alice, await makeRecording(2, 'mine.m4a'));

    const stolen = await app.inject({
      method: 'POST',
      url: '/voice-messages',
      headers: auth(bob),
      payload: { storage_key: storageKey },
    });

    expect(stolen.statusCode).toBe(403);
    expect(stolen.json().error.code).toBe('NOT_OWNER');
  });

  it('경로 탈출(../)이 섞인 키는 막힌다', async () => {
    const escape = await app.inject({
      method: 'POST',
      url: '/voice-messages',
      headers: auth(alice),
      payload: { storage_key: `voice/${alice.id}/../../../../etc/passwd` },
    });

    // 경로 밖으로 나가는 키는 존재 확인 단계에서 실패한다(파일을 읽지 않는다).
    expect(escape.statusCode).toBe(404);
  });

  it('지원하지 않는 형식은 업로드 URL 자체를 안 준다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/voice-messages/upload-url',
      headers: auth(alice),
      payload: { mime_type: 'video/mp4' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('UNSUPPORTED_MIME_TYPE');
  });

  it('서명 없이는 업로드도 다운로드도 안 된다', async () => {
    const { storageKey } = await upload(alice, await makeRecording(2, 'signed.m4a'));

    const noToken = await app.inject({
      method: 'GET',
      url: `/storage/download?key=${encodeURIComponent(storageKey)}&token=forged`,
    });
    expect(noToken.statusCode).toBe(403);
  });

  it('업로드 토큰으로 다운로드할 수 없다 (용도 분리)', async () => {
    const issued = await app.inject({
      method: 'POST',
      url: '/voice-messages/upload-url',
      headers: auth(alice),
      payload: { mime_type: 'audio/mp4' },
    });
    const { storage_key, upload: uploadInfo } = issued.json();
    const uploadToken = new URL(uploadInfo.url).searchParams.get('token')!;

    const response = await app.inject({
      method: 'GET',
      url: `/storage/download?key=${encodeURIComponent(storage_key)}&token=${encodeURIComponent(uploadToken)}`,
    });

    expect(response.statusCode).toBe(403);
  });

  describe('다운로드 URL 접근 권한', () => {
    let voiceId: string;

    beforeEach(async () => {
      const { storageKey } = await upload(alice, await makeRecording(2, 'shared.m4a'));
      const registered = await app.inject({
        method: 'POST',
        url: '/voice-messages',
        headers: auth(alice),
        payload: { storage_key: storageKey },
      });
      voiceId = registered.json().voice_message.id;
    });

    it('소유자는 원본과 iOS용을 모두 받을 수 있다', async () => {
      for (const variant of ['original', 'ios']) {
        const response = await app.inject({
          method: 'GET',
          url: `/voice-messages/${voiceId}/download-url?variant=${variant}`,
          headers: auth(alice),
        });
        expect(response.statusCode).toBe(200);

        // 받은 URL 이 실제로 파일을 내려주는지까지 확인한다
        const target = new URL(response.json().url);
        const download = await app.inject({
          method: 'GET',
          url: target.pathname + target.search,
        });
        expect(download.statusCode).toBe(200);
        expect(download.rawPayload.length).toBeGreaterThan(0);
      }
    });

    it('무관한 사용자는 존재 여부조차 알 수 없다 (404)', async () => {
      const stranger = await signUp(app);
      const response = await app.inject({
        method: 'GET',
        url: `/voice-messages/${voiceId}/download-url`,
        headers: auth(stranger),
      });

      expect(response.statusCode).toBe(404);
    });

    it('알람 수신자는 받을 수 있다', async () => {
      const bob = await signUp(app);
      await becomeFriends(app, alice, bob);

      // 이 녹음을 쓰는 알람이 bob 에게 예약돼 있으면 접근 가능해야 한다
      await prisma.alarm.create({
        data: {
          senderId: alice.id,
          receiverId: bob.id,
          voiceMessageId: voiceId,
          scheduledAt: new Date(Date.now() + 3_600_000),
          timezone: 'Asia/Seoul',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/voice-messages/${voiceId}/download-url?variant=ios`,
        headers: auth(bob),
      });

      expect(response.statusCode).toBe(200);
    });

    it('만료된 다운로드 URL 은 거부된다', async () => {
      const { createStorageToken } = await import('../src/lib/signing.js');
      const row = await prisma.voiceMessage.findUniqueOrThrow({ where: { id: voiceId } });

      const expired = createStorageToken({
        key: row.storageKey,
        purpose: 'dn',
        exp: Math.floor(Date.now() / 1000) - 10,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/storage/download?key=${encodeURIComponent(row.storageKey)}&token=${encodeURIComponent(expired)}`,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('만료');
    });

    it('알람에 쓰이지 않은 녹음은 삭제할 수 있다', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/voice-messages/${voiceId}`,
        headers: auth(alice),
      });

      expect(response.statusCode).toBe(200);
      expect(await prisma.voiceMessage.count()).toBe(0);
    });

    it('이미 알람에 쓰인 녹음은 삭제할 수 없다', async () => {
      const bob = await signUp(app);
      await becomeFriends(app, alice, bob);
      await prisma.alarm.create({
        data: {
          senderId: alice.id,
          receiverId: bob.id,
          voiceMessageId: voiceId,
          scheduledAt: new Date(Date.now() + 3_600_000),
          timezone: 'Asia/Seoul',
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/voice-messages/${voiceId}`,
        headers: auth(alice),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VOICE_MESSAGE_IN_USE');
    });
  });
});
