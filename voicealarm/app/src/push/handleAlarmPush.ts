import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { cancelLocalAlarm, scheduleLocalAlarm } from '../alarms/schedule';
import { deleteLocalAudio, prefetchAlarm } from '../alarms/prefetch';
import type { AlarmPushData } from './pushPayload';

/**
 * 데이터 푸시 한 건을 처리한다. 백그라운드 태스크(앱이 꺼져 있어도)와 포그라운드
 * 리스너 양쪽에서 이 함수 하나만 부른다 — 처리 로직이 두 곳에 따로 있으면
 * 언젠가 갈라진다(Phase 1 의 relationships.ts 와 같은 이유).
 */
export async function handleAlarmPush(client: ApiClient, data: AlarmPushData): Promise<void> {
  if (data.type === 'alarm.scheduled') {
    const { alarm, localAudioUri } = await prefetchAlarm(client, data.alarmId);

    // 푸시가 도착한 사이에 이미 취소/차단됐을 수 있다(레이스). 등록 자체를 하지 않는다.
    if (alarm.status !== 'scheduled') return;

    await scheduleLocalAlarm(alarm, localAudioUri);
    return;
  }

  // alarm.cancelled
  await cancelLocalAlarm(data.alarmId);
  deleteLocalAudio(data.alarmId, Platform.OS === 'ios' ? 'caf' : 'm4a');
}
