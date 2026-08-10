import { File } from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '../auth/AuthContext';
import { Button, ErrorBanner, Heading, Muted, Screen } from '../components';
import { Waveform } from '../components/Waveform';
import { useI18n } from '../i18n/context';
import { formatDuration } from '../recording/formatDuration';
import { MAX_RECORDING_MS } from '../recording/options';
import { uploadRecording } from '../recording/upload';
import { useRecorder } from '../recording/useRecorder';
import { useTheme } from '../theme';

/**
 * 녹음 → 미리듣기 → 업로드.
 *
 * Phase 4 에서 이 화면은 "알람 만들기" 흐름의 한 단계가 된다(친구 선택 → 시간 → 녹음 → 전송).
 * 지금은 업로드까지만 확인할 수 있게 독립 화면으로 둔다.
 */
export function RecordScreen({
  onUploaded,
}: {
  onUploaded?: (voiceMessageId: string, durationMs: number) => void;
}) {
  const { t } = useI18n();
  const { colors, radius, spacing } = useTheme();
  const { client } = useSession();
  const recorder = useRecorder();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const player = useAudioPlayer(recorder.uri ? { uri: recorder.uri } : null);
  const playerStatus = useAudioPlayerStatus(player);

  const remainingSec = Math.max(0, Math.ceil((MAX_RECORDING_MS - recorder.elapsedMs) / 1000));

  async function handleUpload() {
    if (!recorder.uri) return;

    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadRecording(client, recorder.uri, {
        // expo-file-system 의 File 로 바이트를 읽어 그대로 PUT 한다.
        // RN 의 fetch 는 file:// URI 를 body 로 직접 받지 못한다.
        readFile: async (uri) => {
          const bytes = await new File(uri).bytes();
          return bytes.buffer as ArrayBuffer;
        },
      });
      setUploadedId(result.voiceMessageId);
      onUploaded?.(result.voiceMessageId, result.durationMs);
    } catch (error) {
      setUploadError(error);
    } finally {
      setUploading(false);
    }
  }

  function handleRerecord() {
    player.pause();
    setUploadedId(null);
    setUploadError(null);
    recorder.reset();
  }

  return (
    <Screen scroll>
      <Heading>{t('record.title')}</Heading>

      <ErrorBanner error={uploadError} />
      {recorder.error ? <RecorderErrorNote error={recorder.error} /> : null}

      <Waveform levels={recorder.levels} active={recorder.phase === 'recording'} />

      <View style={{ alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl }}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>
          {formatDuration(recorder.elapsedMs)}
        </Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.xs }}>
          {recorder.phase === 'recording'
            ? t('record.remaining', { seconds: remainingSec })
            : t('record.limit', { seconds: Math.round(MAX_RECORDING_MS / 1000) })}
        </Text>
      </View>

      {recorder.phase === 'recorded' ? (
        <View style={{ gap: spacing.md }}>
          <Button
            label={playerStatus.playing ? t('record.pause') : t('record.play')}
            variant="secondary"
            onPress={() => {
              if (playerStatus.playing) {
                player.pause();
              } else {
                // 끝까지 재생된 뒤 다시 누르면 처음부터 나와야 한다
                void player.seekTo(0);
                player.play();
              }
            }}
          />
          <Button
            label={uploadedId ? t('record.uploaded') : t('record.upload')}
            onPress={() => void handleUpload()}
            loading={uploading}
            disabled={uploadedId !== null}
          />
          <Button label={t('record.rerecord')} variant="ghost" onPress={handleRerecord} />
        </View>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(recorder.phase === 'recording' ? 'record.stop' : 'record.start')}
            onPress={() =>
              void (recorder.phase === 'recording' ? recorder.stop() : recorder.start())
            }
            style={({ pressed }) => ({
              width: 88,
              height: 88,
              borderRadius: radius.pill,
              backgroundColor: recorder.phase === 'recording' ? colors.danger : colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                width: recorder.phase === 'recording' ? 28 : 36,
                height: recorder.phase === 'recording' ? 28 : 36,
                borderRadius: recorder.phase === 'recording' ? radius.sm : radius.pill,
                backgroundColor: '#FFFFFF',
              }}
            />
          </Pressable>
          <View style={{ marginTop: spacing.lg, paddingHorizontal: spacing.lg }}>
            <Muted>{t('record.hint')}</Muted>
          </View>
        </View>
      )}
    </Screen>
  );
}

function RecorderErrorNote({ error }: { error: 'PERMISSION_DENIED' | 'TOO_SHORT' | 'FAILED' }) {
  const { t } = useI18n();
  const { colors, spacing } = useTheme();

  const message = {
    PERMISSION_DENIED: t('record.error.permission'),
    TOO_SHORT: t('record.error.tooShort'),
    FAILED: t('record.error.failed'),
  }[error];

  return (
    <Text style={{ color: colors.danger, fontSize: 13, marginBottom: spacing.md }}>{message}</Text>
  );
}
