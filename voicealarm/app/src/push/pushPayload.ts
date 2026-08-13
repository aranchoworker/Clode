/**
 * 서버가 보내는 FCM data 페이로드 파싱. (src/services/push.ts 의 toDataPayload 와 짝을 이룬다.)
 * 순수 함수라 RN 런타임 없이 테스트한다 — 이 파싱이 틀리면 알람이 통째로 조용히 무시된다.
 */
export type AlarmPushData =
  | { type: 'alarm.scheduled'; alarmId: string }
  | { type: 'alarm.cancelled'; alarmId: string; reason: string };

export function parseAlarmPushData(raw: unknown): AlarmPushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.alarm_id !== 'string' || obj.alarm_id.length === 0) return null;
  const alarmId = obj.alarm_id;

  if (obj.type === 'alarm.scheduled') {
    return { type: 'alarm.scheduled', alarmId };
  }
  if (obj.type === 'alarm.cancelled') {
    const reason = typeof obj.reason === 'string' ? obj.reason : 'cancelled';
    return { type: 'alarm.cancelled', alarmId, reason };
  }
  return null;
}

/**
 * expo-notifications 의 백그라운드 태스크는 데이터를 JSON 문자열로 감싸서 준다
 * (`{ data: { dataString: '...' } }`). 여기서 그 겹겹이를 벗긴다.
 */
export function parseBackgroundTaskDataString(dataString: unknown): AlarmPushData | null {
  if (typeof dataString !== 'string') return null;
  try {
    return parseAlarmPushData(JSON.parse(dataString));
  } catch {
    return null;
  }
}
