import type { ApiClient } from '../api/client';
import { api } from '../api/endpoints';

/**
 * 녹음 파일 업로드.
 *
 * 3단계로 나뉜다:
 *   1. 서버에서 업로드 URL 발급  (POST /voice-messages/upload-url)
 *   2. 그 URL 로 파일을 직접 PUT  (서버를 거치지 않음 — S3 로 옮겨도 이 구조 그대로)
 *   3. 완료 등록                 (POST /voice-messages)
 *
 * 3단계에서 서버가 실제 파일을 열어 길이를 다시 잰다. 그래서 앱의 30초 제한이 뚫려도
 * 등록이 거부된다. 여기서 duration 을 보내지 않는 건 그래서다 — 보내 봐야 안 믿는다.
 */

export type UploadDependencies = {
  /** 파일 URI 를 업로드 가능한 바디로 바꾼다. RN 은 Blob 지원이 불완전해서 주입으로 뺐다. */
  readFile: (uri: string) => Promise<ArrayBuffer>;
  /** 생략하면 클라이언트와 같은 fetch 를 쓴다. */
  fetchFn?: typeof fetch;
};

export type UploadResult = {
  voiceMessageId: string;
  durationMs: number;
};

export class UploadError extends Error {
  constructor(
    readonly code: 'PUT_FAILED' | 'READ_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export async function uploadRecording(
  client: ApiClient,
  fileUri: string,
  deps: UploadDependencies,
): Promise<UploadResult> {
  const fetchFn = deps.fetchFn ?? client.fetchImpl;

  const issued = await api.voiceMessages.createUploadUrl(client, 'audio/mp4');

  let body: ArrayBuffer;
  try {
    body = await deps.readFile(fileUri);
  } catch (error) {
    throw new UploadError(
      'READ_FAILED',
      `녹음 파일을 읽을 수 없습니다: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  const put = await fetchFn(issued.upload.url, {
    method: issued.upload.method,
    headers: issued.upload.headers,
    body,
  });

  if (!put.ok) {
    // 업로드 URL 은 만료가 있으므로, 오래 들고 있다가 쓰면 여기서 걸린다.
    throw new UploadError('PUT_FAILED', `업로드에 실패했습니다 (HTTP ${put.status})`);
  }

  const registered = await api.voiceMessages.register(client, issued.storage_key);

  return {
    voiceMessageId: registered.voice_message.id,
    durationMs: registered.voice_message.duration_ms,
  };
}
