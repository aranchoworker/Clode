import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const run = promisify(execFile);

/**
 * 녹음 파일 검사 및 iOS용 변환.
 *
 * 왜 서버에서 다시 재는가: 클라이언트가 보낸 duration_ms 를 믿으면 30초 제한이 무의미하다.
 * 앱을 조금만 고치면 5분짜리를 30초라고 신고할 수 있고, 그건 그대로 괴롭힘 도구가 된다.
 * 길이·포맷 판단은 전부 실제 파일에서 뽑는다.
 */

export class AudioError extends Error {
  constructor(
    readonly code: 'PROBE_FAILED' | 'TRANSCODE_FAILED' | 'NOT_AUDIO',
    message: string,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

export type Probe = {
  durationMs: number;
  codec: string;
  sampleRate: number;
  channels: number;
};

export async function probeAudio(path: string): Promise<Probe> {
  let stdout: string;
  try {
    ({ stdout } = await run(env().FFPROBE_PATH, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_rate,channels:format=duration',
      '-of',
      'json',
      path,
    ]));
  } catch (error) {
    throw new AudioError(
      'PROBE_FAILED',
      `오디오 정보를 읽을 수 없습니다: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  const parsed = JSON.parse(stdout) as {
    streams?: { codec_name?: string; sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };

  const stream = parsed.streams?.[0];
  const duration = Number(parsed.format?.duration);

  if (!stream || !Number.isFinite(duration)) {
    throw new AudioError('NOT_AUDIO', '오디오 트랙을 찾을 수 없습니다.');
  }

  return {
    durationMs: Math.round(duration * 1000),
    codec: stream.codec_name ?? 'unknown',
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: stream.channels ?? 0,
  };
}

/**
 * iOS 알림음용 caf 변환.
 *
 * 포맷 선택 이유:
 * - UNNotificationSound 가 받는 건 Linear PCM / MA4(IMA4) / µLaw / aLaw 뿐이다. aac 는 안 된다.
 * - IMA4 를 고른 건 크기 때문이다. 30초 기준 Linear PCM 은 약 2.6MB, IMA4 는 약 350KB.
 *   이 파일은 알람 예약 시점에 수신자 기기로 미리 내려가야 해서 작을수록 좋다.
 * - 22.05kHz 모노: 사람 목소리에는 충분하고 44.1kHz 대비 절반이다.
 */
export async function transcodeToCaf(inputPath: string, outputPath: string): Promise<void> {
  try {
    await run(env().FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-c:a',
      'adpcm_ima_qt',
      '-ar',
      '22050',
      '-ac',
      '1',
      '-f',
      'caf',
      outputPath,
    ]);
  } catch (error) {
    throw new AudioError(
      'TRANSCODE_FAILED',
      `iOS용 변환에 실패했습니다: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
}

/** 변환 작업용 임시 디렉터리. 예외가 나도 반드시 지운다. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'voicealarm-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function isAudioToolingAvailable(): Promise<boolean> {
  return run(env().FFPROBE_PATH, ['-version'])
    .then(() => true)
    .catch(() => false);
}
