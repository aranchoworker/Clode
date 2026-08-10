import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client';
import { MemoryTokenStore } from '../src/auth/memoryStore';
import { UploadError, uploadRecording } from '../src/recording/upload';
import { normalizeMetering } from '../src/recording/normalizeMetering';
import { formatDuration } from '../src/recording/formatDuration';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ticket = {
  storage_key: 'voice/user-1/abc.m4a',
  upload: {
    url: 'http://api.test/storage/upload?key=voice%2Fuser-1%2Fabc.m4a&token=t',
    method: 'PUT' as const,
    headers: { 'content-type': 'audio/mp4' },
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  },
  max_bytes: 5 * 1024 * 1024,
  max_duration_ms: 30_000,
};

describe('녹음 업로드', () => {
  function makeClient(fetchFn: typeof fetch) {
    return new ApiClient({
      baseUrl: 'http://api.test',
      store: new MemoryTokenStore({ accessToken: 'a', refreshToken: 'r' }),
      fetchFn,
    });
  }

  it('발급 → PUT → 등록 순서로 진행한다', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.includes('/voice-messages/upload-url')) return jsonResponse(200, ticket);
      if (url.includes('/storage/upload')) return jsonResponse(201, { key: ticket.storage_key });
      return jsonResponse(201, {
        voice_message: { id: 'vm-1', duration_ms: 4200, created_at: new Date().toISOString() },
      });
    });

    const result = await uploadRecording(makeClient(fetchFn as never), 'file:///rec.m4a', {
      readFile: async () => new ArrayBuffer(1024),
    });

    expect(calls).toEqual([
      'POST /voice-messages/upload-url',
      'PUT /storage/upload',
      'POST /voice-messages',
    ]);
    expect(result).toEqual({ voiceMessageId: 'vm-1', durationMs: 4200 });
  });

  it('등록 요청에 길이를 보내지 않는다 (서버가 실제 파일을 잰다)', async () => {
    let registerBody: unknown;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/voice-messages/upload-url')) return jsonResponse(200, ticket);
      if (url.includes('/storage/upload')) return jsonResponse(201, {});
      registerBody = JSON.parse(String(init?.body));
      return jsonResponse(201, {
        voice_message: { id: 'vm-1', duration_ms: 1000, created_at: new Date().toISOString() },
      });
    });

    await uploadRecording(makeClient(fetchFn as never), 'file:///rec.m4a', {
      readFile: async () => new ArrayBuffer(8),
    });

    expect(registerBody).toEqual({ storage_key: ticket.storage_key });
  });

  it('PUT 이 실패하면 등록을 시도하지 않는다', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/voice-messages/upload-url')) return jsonResponse(200, ticket);
      if (url.includes('/storage/upload')) return jsonResponse(403, { error: { code: 'EXPIRED' } });
      throw new Error('등록이 호출되면 안 된다');
    });

    await expect(
      uploadRecording(makeClient(fetchFn as never), 'file:///rec.m4a', {
        readFile: async () => new ArrayBuffer(8),
      }),
    ).rejects.toBeInstanceOf(UploadError);
  });

  it('파일을 못 읽으면 업로드를 시작하지 않는다', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/voice-messages/upload-url')) return jsonResponse(200, ticket);
      throw new Error('PUT 이 호출되면 안 된다');
    });

    await expect(
      uploadRecording(makeClient(fetchFn as never), 'file:///gone.m4a', {
        readFile: async () => {
          throw new Error('ENOENT');
        },
      }),
    ).rejects.toMatchObject({ code: 'READ_FAILED' });
  });
});

describe('녹음 표시 계산', () => {
  it('dBFS 를 0~1 로 정규화한다', () => {
    expect(normalizeMetering(0)).toBe(1);
    expect(normalizeMetering(-25)).toBeCloseTo(0.5, 2);
    // -50dB 아래는 사실상 무음이라 바닥으로 깐다(막대 떨림 방지)
    expect(normalizeMetering(-50)).toBe(0);
    expect(normalizeMetering(-160)).toBe(0);
    expect(normalizeMetering(undefined)).toBe(0);
    expect(normalizeMetering(Number.NaN)).toBe(0);
  });

  it('경과 시간을 m:ss 로 표시한다', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(4_200)).toBe('0:04');
    expect(formatDuration(30_000)).toBe('0:30');
    expect(formatDuration(61_500)).toBe('1:01');
  });
});
