/** 경과/전체 시간을 m:ss 로. React Native 에 의존하지 않아 테스트에서 그대로 쓴다. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
