import { describe, expect, it } from 'vitest';
import { parseAlarmPushData, parseBackgroundTaskDataString } from '../src/push/pushPayload';

describe('푸시 페이로드 파싱', () => {
  it('예약 알림을 파싱한다', () => {
    expect(parseAlarmPushData({ type: 'alarm.scheduled', alarm_id: 'a1' })).toEqual({
      type: 'alarm.scheduled',
      alarmId: 'a1',
    });
  });

  it('취소 알림의 reason 을 파싱한다', () => {
    expect(parseAlarmPushData({ type: 'alarm.cancelled', alarm_id: 'a1', reason: 'blocked' })).toEqual(
      { type: 'alarm.cancelled', alarmId: 'a1', reason: 'blocked' },
    );
  });

  it('reason 이 없으면 cancelled 로 기본값을 채운다', () => {
    expect(parseAlarmPushData({ type: 'alarm.cancelled', alarm_id: 'a1' })).toEqual({
      type: 'alarm.cancelled',
      alarmId: 'a1',
      reason: 'cancelled',
    });
  });

  it('alarm_id 가 없거나 타입을 모르면 null', () => {
    expect(parseAlarmPushData({ type: 'alarm.scheduled' })).toBeNull();
    expect(parseAlarmPushData({ type: 'unknown.type', alarm_id: 'a1' })).toBeNull();
    expect(parseAlarmPushData(null)).toBeNull();
    expect(parseAlarmPushData('a1')).toBeNull();
  });

  it('백그라운드 태스크의 이중 JSON 문자열을 벗긴다', () => {
    const dataString = JSON.stringify({ type: 'alarm.scheduled', alarm_id: 'a1' });
    expect(parseBackgroundTaskDataString(dataString)).toEqual({
      type: 'alarm.scheduled',
      alarmId: 'a1',
    });
  });

  it('깨진 JSON 이면 null', () => {
    expect(parseBackgroundTaskDataString('{not json')).toBeNull();
    expect(parseBackgroundTaskDataString(undefined)).toBeNull();
  });
});
