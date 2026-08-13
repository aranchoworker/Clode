import { File } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import type { Alarm } from '../api/types';
import { iosLibrarySoundsDirectory } from './paths';

/**
 * iOS 로컬 알림 스케줄링.
 *
 * 이 파일은 순수 JS 로 완결된다 — iOS 는 Android 와 달리 커스텀 네이티브 모듈 없이도
 * README 의 "iOS 로 낼 수 있는 최선"(Time Sensitive 로컬 알림 + 커스텀 사운드)을 만들 수 있다.
 * `expo-notifications` 의 로컬 알림 스케줄러가 내부적으로 UNCalendarNotificationTrigger 를 쓰고,
 * `Library/Sounds/` 에 파일을 두면 `UNNotificationSound(named:)` 가 그 파일을 찾는 건
 * iOS 자체의 문서화된 동작이라 Expo 가 막아 둔 게 아니기 때문이다.
 *
 * ⚠️ 실기기(시뮬레이터는 푸시 배달이 제한적)에서 검증되지 않았다. 특히
 * paths.ts 의 Library 경로 유도가 실제로 맞는지가 가장 먼저 확인해야 할 지점이다.
 */

export const ALARM_NOTIFICATION_CATEGORY = 'voicealarm.alarm';

/** 앱 시작 시 한 번 호출. "다시 알림/해제" 버튼을 정의한다. */
export async function registerAlarmNotificationCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(ALARM_NOTIFICATION_CATEGORY, [
    { identifier: 'SNOOZE', buttonTitle: '다시 알림' },
    { identifier: 'DISMISS', buttonTitle: '해제', options: { isDestructive: true } },
  ]);
}

/**
 * caf 파일을 iOS 가 찾는 위치로 옮기고, 그 파일명으로 알림을 예약한다.
 * 알림 identifier 를 alarmId 로 고정해서, 취소할 때 별도 매핑 없이 바로 지울 수 있게 한다.
 */
export async function scheduleIosAlarm(alarm: Alarm, localAudioUri: string): Promise<void> {
  const soundFileName = `${alarm.id}.caf`;
  const soundFile = new File(iosLibrarySoundsDirectory(), soundFileName);

  if (!soundFile.exists) {
    const source = new File(localAudioUri);
    // File 에는 "다른 File 로 복사" API 가 없어서(현재 expo-file-system 버전 기준) 바이트를 그대로 옮겨 쓴다.
    // 30초 알림음이라 최대 몇백 KB 수준이라 메모리에 올려도 무리 없다.
    soundFile.write(source.bytesSync());
  }

  const body = alarm.title ?? '음성 알람이 도착했습니다.';

  await Notifications.scheduleNotificationAsync({
    identifier: alarm.id,
    content: {
      title: alarm.sender.display_name,
      body,
      sound: soundFileName,
      // Critical Alerts 는 쓰지 않는다(프로젝트 방침). Time Sensitive 는 별도 승인이
      // 필요 없는 자체 서비스 엔타이틀먼트라 이걸 쓴다 — 무음 스위치는 못 뚫는다.
      interruptionLevel: 'timeSensitive',
      categoryIdentifier: ALARM_NOTIFICATION_CATEGORY,
      // 발화된 알림에서는 sound 필드가 파일명이 아니라 'custom' 으로만 나온다.
      // "다시 알림"으로 재예약할 때 필요한 정보를 여기 실어 둔다.
      data: { alarmId: alarm.id, kind: 'voicealarm', soundFileName, senderName: alarm.sender.display_name, bodyText: body },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alarm.scheduled_at),
    },
  });
}

export async function cancelIosAlarm(alarmId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(alarmId);

  const soundFile = new File(iosLibrarySoundsDirectory(), `${alarmId}.caf`);
  if (soundFile.exists) soundFile.delete();
}
