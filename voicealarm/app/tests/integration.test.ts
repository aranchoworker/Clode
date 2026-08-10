import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/api/client';
import { api } from '../src/api/endpoints';
import { MemoryTokenStore } from '../src/auth/memoryStore';
import { uploadRecording } from '../src/recording/upload';

const run = promisify(execFile);

/**
 * 앱의 엔드포인트 래퍼를 실제로 돌아가는 서버에 붙여서 확인한다.
 *
 * 목(mock) 테스트만으로는 경로 오타나 snake_case 필드 불일치를 못 잡는다.
 * 그런 건 기기에 올려서야 발견되는데, 그때는 원인을 찾는 데 훨씬 오래 걸린다.
 *
 * 실행:
 *   (터미널 1) cd ../server && npm run dev
 *   (터미널 2) VOICEALARM_API_URL=http://localhost:3000 npm test
 *
 * 서버 주소가 없으면 조용히 건너뛴다(기본 `npm test` 는 서버 없이 돌아야 하므로).
 */
const BASE_URL = process.env.VOICEALARM_API_URL;

describe.skipIf(!BASE_URL)('실제 서버 연동', () => {
  const unique = () => `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function makeClient() {
    return new ApiClient({ baseUrl: BASE_URL!, store: new MemoryTokenStore() });
  }

  async function signUp(client: ApiClient) {
    const userId = unique();
    const session = await api.auth.signup(client, {
      userId,
      password: 'password123',
      displayName: userId,
    });
    await client.setTokens({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });
    return session;
  }

  beforeAll(async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.ok, `서버(${BASE_URL})에 연결할 수 없습니다`).toBe(true);
  });

  it('가입 → 검색 → 친구 요청 → 수락 → 목록까지 앱 코드로 관통한다', async () => {
    const alice = makeClient();
    const bob = makeClient();

    const aliceSession = await signUp(alice);
    const bobSession = await signUp(bob);

    // 정확 일치 검색
    const found = await api.users.search(alice, bobSession.user.user_id);
    expect(found.user.id).toBe(bobSession.user.id);
    expect(found.relation).toBeNull();

    // 요청 → 받은 요청 목록에 나타남
    await api.friends.sendRequest(alice, bobSession.user.user_id);
    const incoming = await api.friends.requests(bob, 'incoming');
    const request = incoming.requests.find((r) => r.user.id === aliceSession.user.id);
    expect(request).toBeDefined();
    expect(request!.direction).toBe('incoming');

    // 수락 전에는 친구 목록이 비어 있다
    expect((await api.friends.list(bob)).friends).toHaveLength(0);

    await api.friends.accept(bob, request!.id);

    const friends = await api.friends.list(alice);
    expect(friends.friends.map((f) => f.id)).toContain(bobSession.user.id);
  });

  it('차단하면 상대에게 존재하지 않는 것처럼 보인다', async () => {
    const alice = makeClient();
    const bob = makeClient();
    const aliceSession = await signUp(alice);
    const bobSession = await signUp(bob);

    await api.blocks.create(bob, aliceSession.user.user_id);

    await expect(api.users.search(alice, bobSession.user.user_id)).rejects.toMatchObject({
      status: 404,
      code: 'USER_NOT_FOUND',
    });

    const blocks = await api.blocks.list(bob);
    expect(blocks.blocks.map((b) => b.user.id)).toContain(aliceSession.user.id);
  });

  it('access 토큰이 죽어도 클라이언트가 알아서 재발급받는다', async () => {
    const alice = makeClient();
    const session = await signUp(alice);

    // access 토큰만 망가뜨린다. refresh 는 살아 있으므로 조용히 복구돼야 한다.
    await alice.setTokens({
      accessToken: 'obviously.invalid.token',
      refreshToken: session.refresh_token,
    });

    const me = await api.auth.me(alice);
    expect(me.user.id).toBe(session.user.id);
  });

  describe('녹음 업로드', () => {
    let workDir: string;

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'voicealarm-app-'));
    });

    afterAll(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    /** ffmpeg 로 진짜 m4a 를 만든다. 더미 바이트로는 서버의 길이 검사를 통과하지 못한다. */
    async function makeRecording(seconds: number, name: string): Promise<string> {
      const path = join(workDir, name);
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
        '-c:a', 'aac', '-b:a', '48k', '-ar', '22050', '-ac', '1',
        path,
      ]);
      return path;
    }

    async function upload(client: ApiClient, path: string) {
      return uploadRecording(client, path, {
        readFile: async (uri) => {
          const buffer = await readFile(uri);
          return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
        },
      });
    }

    it('발급 → PUT → 등록이 실제 서버에서 관통하고, 서버가 길이를 직접 잰다', async () => {
      const alice = makeClient();
      await signUp(alice);

      const result = await upload(alice, await makeRecording(3, 'ok.m4a'));

      expect(result.voiceMessageId).toBeTruthy();
      // 앱은 길이를 보내지 않는다. 이 값은 서버가 파일에서 뽑은 것이다.
      expect(result.durationMs).toBeGreaterThan(2_500);
      expect(result.durationMs).toBeLessThan(3_500);
    });

    it('30초를 넘기면 서버가 거부한다', async () => {
      const alice = makeClient();
      await signUp(alice);

      await expect(upload(alice, await makeRecording(35, 'long.m4a'))).rejects.toMatchObject({
        code: 'RECORDING_TOO_LONG',
      });
    });

    it('iOS용 caf 다운로드 URL 이 실제로 파일을 내려준다', async () => {
      const alice = makeClient();
      await signUp(alice);
      const uploaded = await upload(alice, await makeRecording(2, 'caf.m4a'));

      const link = await api.voiceMessages.downloadUrl(alice, uploaded.voiceMessageId, 'ios');
      const response = await fetch(link.url);

      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(0);
      // caf 파일은 'caff' 매직으로 시작한다
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('caff');
    });

    it('남의 녹음은 존재 여부조차 알 수 없다', async () => {
      const alice = makeClient();
      const stranger = makeClient();
      await signUp(alice);
      await signUp(stranger);

      const uploaded = await upload(alice, await makeRecording(2, 'private.m4a'));

      await expect(
        api.voiceMessages.downloadUrl(stranger, uploaded.voiceMessageId),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('알람 파이프라인', () => {
    async function becomeFriends(a: ApiClient, aUserId: string, b: ApiClient, bUserId: string) {
      await api.friends.sendRequest(a, bUserId);
      const incoming = await api.friends.requests(b, 'incoming');
      const request = incoming.requests.find((r) => r.user.user_id === aUserId);
      if (!request) throw new Error('friend request not found');
      await api.friends.accept(b, request.id);
    }

    it('예약 → 목록 → validity → ack 가 실제 서버에서 전부 관통한다', async () => {
      const alice = makeClient();
      const bob = makeClient();
      const aliceSession = await signUp(alice);
      const bobSession = await signUp(bob);
      await becomeFriends(alice, aliceSession.user.user_id, bob, bobSession.user.user_id);

      const workDir = await mkdtemp(join(tmpdir(), 'voicealarm-alarm-'));
      const path = join(workDir, 'msg.m4a');
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:a', 'aac', '-b:a', '48k', '-ar', '22050', '-ac', '1',
        path,
      ]);
      const uploaded = await uploadRecording(alice, path, {
        readFile: async (uri) => {
          const buffer = await readFile(uri);
          return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
        },
      });

      const scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      const created = await api.alarms.create(alice, {
        receiverUserId: bobSession.user.user_id,
        voiceMessageId: uploaded.voiceMessageId,
        scheduledAt,
        timezone: 'Asia/Seoul',
        title: '일어나!',
      });
      expect(created.alarm.status).toBe('scheduled');

      const received = await api.alarms.list(bob, 'received');
      expect(received.alarms.map((a) => a.id)).toContain(created.alarm.id);

      const validity = await api.alarms.checkValidity(bob, created.alarm.id);
      expect(validity).toEqual({ valid: true, reason: null });

      await api.alarms.ack(bob, created.alarm.id, true);
      const detail = await api.alarms.get(alice, created.alarm.id);
      expect(detail.alarm.status).toBe('delivered');

      await rm(workDir, { recursive: true, force: true });
    });

    it('예약 후 차단되면 validity 가 invalid 로 바뀐다', async () => {
      const alice = makeClient();
      const bob = makeClient();
      const aliceSession = await signUp(alice);
      const bobSession = await signUp(bob);
      await becomeFriends(alice, aliceSession.user.user_id, bob, bobSession.user.user_id);

      const workDir = await mkdtemp(join(tmpdir(), 'voicealarm-alarm-'));
      const path = join(workDir, 'msg.m4a');
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:a', 'aac', '-b:a', '48k', '-ar', '22050', '-ac', '1',
        path,
      ]);
      const uploaded = await uploadRecording(alice, path, {
        readFile: async (uri) => {
          const buffer = await readFile(uri);
          return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
        },
      });

      const created = await api.alarms.create(alice, {
        receiverUserId: bobSession.user.user_id,
        voiceMessageId: uploaded.voiceMessageId,
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        timezone: 'Asia/Seoul',
      });

      await api.blocks.create(bob, aliceSession.user.user_id);

      const validity = await api.alarms.checkValidity(bob, created.alarm.id);
      expect(validity).toEqual({ valid: false, reason: 'blocked' });

      await rm(workDir, { recursive: true, force: true });
    });

    it('친구가 아니면 알람 생성이 거부된다', async () => {
      const alice = makeClient();
      const bob = makeClient();
      await signUp(alice);
      const bobSession = await signUp(bob);

      await expect(
        api.alarms.create(alice, {
          receiverUserId: bobSession.user.user_id,
          // 형식만 유효한 무작위 UUID. 존재하지 않아도 친구 검증이 먼저 걸린다.
          voiceMessageId: '00000000-0000-4000-8000-000000000000',
          scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
          timezone: 'Asia/Seoul',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FRIENDS' });
    });
  });
});
