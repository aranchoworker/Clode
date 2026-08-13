import { Platform } from 'react-native';
import type { Alarm } from '../api/types';
import { cancelAndroidAlarm, scheduleAndroidAlarm } from './androidAlarm';
import { cancelIosAlarm, scheduleIosAlarm } from './iosAlarm';

/** 플랫폼별 스케줄러로 분기하는 지점. 다른 코드는 이 함수 하나만 알면 된다. */
export function scheduleLocalAlarm(alarm: Alarm, localAudioUri: string): Promise<void> {
  return Platform.OS === 'ios'
    ? scheduleIosAlarm(alarm, localAudioUri)
    : scheduleAndroidAlarm(alarm, localAudioUri);
}

export function cancelLocalAlarm(alarmId: string): Promise<void> {
  return Platform.OS === 'ios' ? cancelIosAlarm(alarmId) : cancelAndroidAlarm(alarmId);
}
