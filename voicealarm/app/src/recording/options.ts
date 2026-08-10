import type { RecordingOptions } from 'expo-audio';

/** 녹음 상한. 서버(MAX_RECORDING_MS)와 반드시 같아야 한다. */
export const MAX_RECORDING_MS = 30_000;

/** 이 길이 미만은 사고로 누른 것으로 보고 저장하지 않는다. */
export const MIN_RECORDING_MS = 700;

/**
 * 녹음 설정.
 *
 * 두 플랫폼 모두 m4a(AAC) 컨테이너로 통일한다. 서버가 iOS 알림음용 caf 를 따로
 * 만들어 주므로, 앱에서는 재생하기 좋은 형식 하나만 만들면 된다.
 *
 * 22.05kHz 모노 / 48kbps 인 이유:
 * - 목소리 한 마디에 필요한 대역은 이 정도면 충분하다.
 * - 30초에 약 180KB. 이 파일은 예약 시점에 수신자 기기로 미리 내려가야 해서,
 *   모바일 데이터에서도 부담 없는 크기여야 한다.
 * - 서버 업로드 상한(5MB)에 걸릴 여지도 없앤다.
 */
export const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: 'aac ',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/mp4',
    bitsPerSecond: 48_000,
  },
};

export const RECORDING_MIME_TYPE = 'audio/mp4';
