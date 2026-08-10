import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeMetering } from './normalizeMetering';
import { MAX_RECORDING_MS, MIN_RECORDING_MS, RECORDING_OPTIONS } from './options';

export type RecorderPhase = 'idle' | 'recording' | 'recorded';

export type RecorderError = 'PERMISSION_DENIED' | 'TOO_SHORT' | 'FAILED' | null;

export type Recorder = {
  phase: RecorderPhase;
  /** 녹음 중 경과 시간(ms). 남은 시간 표시에 쓴다. */
  elapsedMs: number;
  /** 0~1 로 정규화한 입력 레벨. 파형 표시용. */
  level: number;
  /** 최근 레벨 이력(파형 막대). 오래된 것이 앞. */
  levels: number[];
  uri: string | null;
  error: RecorderError;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
};

/**
 * 30초 제한 녹음기.
 *
 * 제한을 강제하는 지점이 두 곳이다:
 *   - 여기(앱): 30초에 도달하면 자동으로 멈춘다. 사용자가 손을 떼지 않아도 잘린다.
 *   - 서버: 실제 파일 길이를 다시 잰다.
 * 앱의 제한은 편의고, 서버의 제한이 진짜다. 앱만 믿으면 앱을 고쳐서 우회할 수 있다.
 */
export function useRecorder(): Recorder {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 100);

  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<RecorderError>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const startedAt = useRef(0);

  const level = normalizeMetering(state.metering);

  // 파형 막대 이력. 녹음 중에만 쌓는다.
  useEffect(() => {
    if (!state.isRecording) return;
    setLevels((prev) => [...prev.slice(-59), level]);
  }, [state.isRecording, state.durationMillis, level]);

  const stop = useCallback(async () => {
    if (!recorder.isRecording) return;

    const elapsed = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      setError('FAILED');
      setPhase('idle');
      return;
    }

    // 실수로 눌렀다 뗀 경우. 파일을 남기면 빈 알람이 만들어진다.
    if (elapsed < MIN_RECORDING_MS) {
      setError('TOO_SHORT');
      setPhase('idle');
      setUri(null);
      setLevels([]);
      return;
    }

    setUri(recorder.uri);
    setPhase('recorded');
  }, [recorder]);

  // 30초 자동 종료. 사용자가 계속 누르고 있어도 여기서 끊긴다.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= MAX_RECORDING_MS) {
      void stop();
    }
  }, [state.isRecording, state.durationMillis, stop]);

  const start = useCallback(async () => {
    setError(null);

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('PERMISSION_DENIED');
      return;
    }

    // iOS 는 이 설정 없이 녹음하면 소리가 안 잡히거나 무음 스위치에 걸린다.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    try {
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      recorder.record();
    } catch {
      setError('FAILED');
      return;
    }

    startedAt.current = Date.now();
    setLevels([]);
    setUri(null);
    setPhase('recording');
  }, [recorder]);

  const reset = useCallback(() => {
    setPhase('idle');
    setUri(null);
    setLevels([]);
    setError(null);
  }, []);

  return {
    phase,
    elapsedMs: Math.min(state.durationMillis, MAX_RECORDING_MS),
    level,
    levels,
    uri,
    error,
    start,
    stop,
    reset,
  };
}

export { MAX_RECORDING_MS, MIN_RECORDING_MS, normalizeMetering, RecordingPresets };
