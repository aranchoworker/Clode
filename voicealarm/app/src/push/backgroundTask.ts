import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { api } from '../api/endpoints';
import { ALARM_NOTIFICATION_CATEGORY } from '../alarms/iosAlarm';
import { getBackgroundClient } from './backgroundClient';
import { handleAlarmPush } from './handleAlarmPush';
import { parseBackgroundTaskDataString } from './pushPayload';

/**
 * FCM 데이터 푸시(백그라운드/종료 상태 포함)와 iOS 알림 액션 응답을 처리하는 진입점.
 *
 * `TaskManager.defineTask` 는 앱이 일찍 로드하는 모듈의 최상위 스코프에서 실행돼야 한다
 * (index.ts 에서 import 한다) — 그래야 앱이 꺼져 있다가 이 작업만으로 깨어날 때도
 * 태스크 정의가 이미 등록돼 있다.
 *
 * ⚠️ 이 파일 전체가 실기기 없이는 동작을 확인할 수 없다. 특히 "앱이 완전히 종료된 상태에서
 * 데이터 푸시로 깨어나는지"는 OEM 배터리 최적화 정책에 따라 기기마다 다르게 동작한다.
 */
export const BACKGROUND_NOTIFICATION_TASK = 'voicealarm-background-notification';

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) return;
  await handleNotificationTaskPayload(data);
});

/** index.ts 에서 앱 시작 시 한 번 호출한다. */
export async function registerBackgroundNotificationTask(): Promise<void> {
  await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
}

/**
 * 태스크 콜백과 포그라운드 리스너가 공유하는 실제 처리 로직.
 * 두 진입점이 각자 처리 로직을 가지면 언젠가 갈라진다 — 그래서 export 해서 하나만 쓴다.
 */
export async function handleNotificationTaskPayload(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object') return;

  if ('actionIdentifier' in payload) {
    // iOS 알림 액션(다시 알림/해제) 또는 알림을 눌러서 앱을 연 경우.
    await handleNotificationResponse(payload as Notifications.NotificationResponse);
    return;
  }

  const raw = (payload as { data?: { dataString?: unknown } }).data;
  const parsed = parseBackgroundTaskDataString(raw?.dataString);
  if (!parsed) return;

  await handleAlarmPush(getBackgroundClient(), parsed);
}

/** 앱이 열려 있을 때도 같은 로직을 타도록 포그라운드에서 등록하는 리스너. */
export function addForegroundNotificationResponseListener(): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    void handleNotificationResponse(response);
  });
}

async function handleNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
  const data = response.notification.request.content.data as
    | { alarmId?: unknown; soundFileName?: unknown; senderName?: unknown; bodyText?: unknown }
    | undefined;
  const alarmId = typeof data?.alarmId === 'string' ? data.alarmId : null;
  if (!alarmId) return;

  const client = getBackgroundClient();

  if (response.actionIdentifier === 'SNOOZE') {
    // 이미 내려받은 사운드 파일을 그대로 재사용한다 — 네트워크 없이도 동작해야 한다.
    const soundFileName = typeof data?.soundFileName === 'string' ? data.soundFileName : undefined;
    const snoozeUntil = new Date(Date.now() + 5 * 60 * 1000);

    await Notifications.scheduleNotificationAsync({
      identifier: alarmId,
      content: {
        title: typeof data?.senderName === 'string' ? data.senderName : '',
        body: typeof data?.bodyText === 'string' ? data.bodyText : '',
        sound: soundFileName,
        interruptionLevel: 'timeSensitive',
        categoryIdentifier: ALARM_NOTIFICATION_CATEGORY,
        data,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: snoozeUntil },
    });
    return;
  }

  // DISMISS 또는 기본 탭(알림을 눌러 앱을 염) 모두 "확인했다"로 본다.
  // 서버 도달 실패는 조용히 무시한다 — 사용자 쪽에서 재시도할 방법이 없는 상황이라
  // 에러를 띄워 봐야 혼란만 준다. 서버는 이미 알림이 발화된 사실을 알 필요가 없다
  // (ack 는 통계·"이미 발화됨" 표시용이지, 안전 규칙과는 무관하다).
  await api.alarms.ack(client, alarmId, true).catch(() => undefined);
}
