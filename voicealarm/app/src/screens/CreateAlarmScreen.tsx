import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { api } from '../api/endpoints';
import type { PublicUser } from '../api/types';
import { useSession } from '../auth/AuthContext';
import { EmptyState, ErrorBanner, Heading, Loading, Muted, Screen } from '../components';
import { useI18n } from '../i18n/context';
import { useAsync } from '../lib/useAsync';
import type { AlarmContext } from './RecordScreen';
import { useTheme } from '../theme';

/** 기기가 데이터 푸시를 받고 파일을 내려받을 시간을 감안한 최소 여유. 서버 MIN_ALARM_LEAD_SEC 과 맞춘다. */
const MIN_LEAD_MS = 2 * 60 * 1000;
const DEFAULT_LEAD_MS = 10 * 60 * 1000;

/**
 * 알람 만들기 1단계: 받을 사람과 시각을 고른다.
 * 다음 단계(녹음)는 RecordScreen 이 알람 컨텍스트를 받아서 이어간다.
 */
export function CreateAlarmScreen({ onNext }: { onNext: (context: AlarmContext) => void }) {
  const { t } = useI18n();
  const { colors, radius, spacing } = useTheme();
  const { client } = useSession();

  const { data, error, loading } = useAsync(() => api.friends.list(client), [client]);

  const [receiver, setReceiver] = useState<PublicUser | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => new Date(Date.now() + DEFAULT_LEAD_MS));
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  // 기기 타임존. 알람 메타데이터에 함께 저장해서, 수신자가 다른 타임존으로 이동해도
  // "보낸 사람이 의도한 그 시각"을 재해석할 근거로 남긴다.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const tooSoon = scheduledAt.getTime() < Date.now() + MIN_LEAD_MS;
  const canProceed = receiver !== null && !tooSoon;

  function handleDateChange(event: DateTimePickerEvent, picked?: Date) {
    setShowDate(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !picked) return;
    setScheduledAt((prev) => mergeDate(prev, picked));
  }

  function handleTimeChange(event: DateTimePickerEvent, picked?: Date) {
    setShowTime(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !picked) return;
    setScheduledAt((prev) => mergeTime(prev, picked));
  }

  return (
    <Screen scroll>
      <Heading>{t('createAlarm.title')}</Heading>

      <ErrorBanner error={error} />

      <SectionLabel>{t('createAlarm.friend')}</SectionLabel>
      {loading ? (
        <Loading />
      ) : (data?.friends.length ?? 0) === 0 ? (
        <EmptyState message={t('friends.empty')} />
      ) : (
        <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
          {data!.friends.map((friend) => {
            const selected = receiver?.id === friend.id;
            return (
              <Pressable
                key={friend.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setReceiver(friend)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.primary : colors.surface,
                }}
              >
                <View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '600',
                      color: selected ? colors.primaryText : colors.text,
                    }}
                  >
                    {friend.display_name}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: selected ? colors.primaryText : colors.textMuted,
                      marginTop: 2,
                    }}
                  >
                    @{friend.user_id}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <SectionLabel>{t('createAlarm.time')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TimeChip label={formatDate(scheduledAt)} onPress={() => setShowDate(true)} />
        <TimeChip label={formatTime(scheduledAt)} onPress={() => setShowTime(true)} />
      </View>
      <Muted>{t('createAlarm.timezone', { timezone })}</Muted>

      {tooSoon ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>{t('createAlarm.tooSoon')}</Text>
        </View>
      ) : null}

      {showDate ? (
        <DateTimePicker
          value={scheduledAt}
          mode="date"
          display="default"
          minimumDate={new Date()}
          onChange={handleDateChange}
        />
      ) : null}
      {showTime ? (
        <DateTimePicker value={scheduledAt} mode="time" display="default" onChange={handleTimeChange} />
      ) : null}

      <View style={{ marginTop: spacing.xl }}>
        <Pressable
          accessibilityRole="button"
          disabled={!canProceed}
          onPress={() =>
            receiver &&
            onNext({
              receiverUserId: receiver.user_id,
              receiverDisplayName: receiver.display_name,
              scheduledAt: scheduledAt.toISOString(),
              timezone,
            })
          }
          style={{
            backgroundColor: canProceed ? colors.primary : colors.surfaceAlt,
            borderRadius: radius.md,
            paddingVertical: spacing.md + 2,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: canProceed ? colors.primaryText : colors.textMuted,
              fontWeight: '600',
              fontSize: 15,
            }}
          >
            {t('createAlarm.next')}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { colors, spacing } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '700',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.sm,
        marginTop: spacing.md,
      }}
    >
      {children}
    </Text>
  );
}

function TimeChip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function mergeDate(base: Date, datePart: Date): Date {
  const next = new Date(base);
  next.setFullYear(datePart.getFullYear(), datePart.getMonth(), datePart.getDate());
  return next;
}

function mergeTime(base: Date, timePart: Date): Date {
  const next = new Date(base);
  next.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
  return next;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
