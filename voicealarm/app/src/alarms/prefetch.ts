import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { api } from '../api/endpoints';
import type { Alarm } from '../api/types';
import { alarmAudioDirectory, alarmAudioFileName } from './paths';

export type PrefetchResult = {
  alarm: Alarm;
  /** 로컬에 내려받은 재생용 파일의 file:// URI. */
  localAudioUri: string;
};

/**
 * 데이터 푸시를 받은 직후 호출한다.
 *
 * 1. GET /alarms/:id 로 전체 정보를 받는다 (푸시 페이로드에는 alarm_id 뿐이었다).
 * 2. 플랫폼에 맞는 변형(iOS 는 caf, Android 는 원본)의 서명 다운로드 URL을 받는다.
 * 3. 파일을 기기에 저장한다.
 *
 * 여기서 실패하면(네트워크 끊김 등) 이 알람은 로컬에 등록되지 않는다 — 발화 시각에
 * 파일이 없으면 어차피 재생할 수 없으므로, 실패를 조용히 삼키지 않고 호출부가
 * 재시도 여부를 결정하게 던진다.
 */
export async function prefetchAlarm(client: ApiClient, alarmId: string): Promise<PrefetchResult> {
  const { alarm } = await api.alarms.get(client, alarmId);

  const variant = Platform.OS === 'ios' ? 'ios' : 'original';
  const download = await api.voiceMessages.downloadUrl(client, alarm.voice_message.id, variant);

  const extension = variant === 'ios' ? 'caf' : 'm4a';
  const destination = new File(alarmAudioDirectory(), alarmAudioFileName(alarm.id, extension));

  const downloaded = await File.downloadFileAsync(download.url, destination, { idempotent: true });

  return { alarm, localAudioUri: downloaded.uri };
}

/** 취소/차단/발화 완료된 알람의 로컬 파일을 지운다. 디스크에 계속 쌓이는 걸 막는다. */
export function deleteLocalAudio(alarmId: string, extension: 'caf' | 'm4a'): void {
  const file = new File(alarmAudioDirectory(), alarmAudioFileName(alarmId, extension));
  if (file.exists) file.delete();
}
