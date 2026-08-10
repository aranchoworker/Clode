/**
 * metering 은 dBFS(대략 -160 ~ 0)로 온다. 파형 막대에 쓰려면 0~1 로 바꿔야 한다.
 * -50dB 아래는 사실상 무음이라 바닥으로 깔아서, 조용한 구간에서 막대가 떨리지 않게 한다.
 *
 * expo-audio 에 의존하지 않는 순수 함수라 별도 파일로 뒀다 —
 * useRecorder.ts 는 네이티브 모듈을 import 해서 Node 에서 테스트할 수 없다.
 */
export function normalizeMetering(metering: number | undefined): number {
  if (metering === undefined || !Number.isFinite(metering)) return 0;
  const floor = -50;
  if (metering <= floor) return 0;
  if (metering >= 0) return 1;
  return (metering - floor) / -floor;
}
