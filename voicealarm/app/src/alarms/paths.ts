import { Directory, Paths } from 'expo-file-system';

/**
 * 다운로드한 음성 파일을 저장하는 위치.
 *
 * document 디렉터리를 쓴다(cache 가 아니다) — 시스템이 저장 공간 부족 시 cache 를 마음대로
 * 지울 수 있는데, 그러면 아직 안 울린 알람의 소리 파일이 사라진다.
 */
export function alarmAudioDirectory(): Directory {
  const dir = new Directory(Paths.document, 'alarms');
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

export function alarmAudioFileName(alarmId: string, extension: string): string {
  return `${alarmId}.${extension}`;
}

/**
 * iOS 의 Library/Sounds 디렉터리.
 *
 * expo-file-system 의 새 API(Paths)는 document/cache/bundle 만 노출하고 Library 는
 * 공식적으로 제공하지 않는다. 하지만 iOS 샌드박스 레이아웃에서 Library 는 Documents 와
 * 항상 형제 디렉터리다(`<컨테이너>/Documents`, `<컨테이너>/Library`) — 이 관계는 애플이
 * 공식 문서화한 샌드박스 구조라 안정적이다. document 경로에서 마지막 구간만 바꿔 유도한다.
 *
 * ⚠️ 이 함수는 기기에서 검증되지 않았다. iOS 실기기/시뮬레이터에서 반드시 확인해야 한다
 * (README 의 "검증되지 않은 부분" 참고). 문제가 생기면 네이티브 모듈로
 * `NSSearchPathForDirectoriesInDomains(.libraryDirectory, .userDomainMask, true)` 를
 * 직접 노출하는 게 정공법이다.
 */
export function iosLibrarySoundsDirectory(): Directory {
  const documentUri = Paths.document.uri; // file:///.../Documents/ (끝에 슬래시 포함 가능)
  const trimmed = documentUri.replace(/\/$/, '');
  if (!trimmed.endsWith('/Documents')) {
    throw new Error(`예상치 못한 document 경로 형식입니다: ${documentUri}`);
  }
  const libraryUri = trimmed.slice(0, -'/Documents'.length) + '/Library/Sounds';
  const dir = new Directory(libraryUri);
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}
