import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/endpoints';
import type { Alarm, AlarmStatus } from '../api/types';
import { useSession } from '../auth/AuthContext';
import { Button, EmptyState, ErrorBanner, Heading, Screen, SegmentedTabs } from '../components';
import { useI18n } from '../i18n/context';
import type { TranslationKey } from '../i18n';
import { useAsync } from '../lib/useAsync';
import { useTheme } from '../theme';

type Tab = 'received' | 'sent';

/**
 * 알람 목록.
 *
 * "받을 알람"은 아직 울리지 않은(scheduled) 것만 의미가 있다 — 지나간 알람은
 * delivered/blocked/cancelled 로 상태만 남는다. "보낸 알람"은 전부 보여주고
 * 상태 배지로 구분한다(취소할 수 있는 건 scheduled 뿐).
 */
export function HomeScreen({ onCreateAlarm }: { onCreateAlarm: () => void }) {
  const { t } = useI18n();
  const { spacing } = useTheme();
  const { client } = useSession();
  const [tab, setTab] = useState<Tab>('received');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(
    () => api.alarms.list(client, tab),
    [client, tab],
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  function confirmCancel(alarm: Alarm) {
    Alert.alert(t('home.cancelAlarm'), t('home.cancelAlarm.confirm', { name: alarm.receiver.display_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('home.cancelAlarm'),
        style: 'destructive',
        onPress: async () => {
          setCancellingId(alarm.id);
          try {
            await api.alarms.cancel(client, alarm.id);
            await reload();
          } catch (caught) {
            Alert.alert(caught instanceof Error ? caught.message : t('common.error.unknown'));
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  }

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Heading>{t('home.title')}</Heading>
          <View style={{ marginBottom: spacing.lg }}>
            <Button label={t('home.newAlarm')} onPress={onCreateAlarm} compact />
          </View>
        </View>

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'received', label: t('home.tab.received') },
            { value: 'sent', label: t('home.tab.sent') },
          ]}
        />

        <ErrorBanner error={error} />
      </View>

      <FlatList
        data={data?.alarms ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
        ListEmptyComponent={!loading ? <EmptyState message={t('home.empty')} /> : null}
        renderItem={({ item }) => (
          <AlarmRow
            alarm={item}
            perspective={tab}
            onCancel={
              tab === 'sent' && item.status === 'scheduled'
                ? () => confirmCancel(item)
                : undefined
            }
            cancelling={cancellingId === item.id}
          />
        )}
      />
    </Screen>
  );
}

function AlarmRow({
  alarm,
  perspective,
  onCancel,
  cancelling,
}: {
  alarm: Alarm;
  perspective: Tab;
  onCancel?: () => void;
  cancelling: boolean;
}) {
  const { t } = useI18n();
  const { colors, radius, spacing } = useTheme();
  const counterpart = perspective === 'sent' ? alarm.receiver : alarm.sender;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
            {counterpart.display_name}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            {formatScheduledAt(alarm.scheduled_at)}
          </Text>
        </View>
        <StatusBadge status={alarm.status} />
      </View>

      {onCancel ? (
        <View style={{ marginTop: spacing.sm, alignItems: 'flex-start' }}>
          <Button
            label={t('home.cancelAlarm')}
            variant="secondary"
            compact
            disabled={cancelling}
            onPress={onCancel}
          />
        </View>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: { status: AlarmStatus }) {
  const { t } = useI18n();
  const { colors, radius } = useTheme();

  const palette: Record<AlarmStatus, { bg: string; fg: string }> = {
    scheduled: { bg: colors.surfaceAlt, fg: colors.text },
    delivered: { bg: colors.surfaceAlt, fg: colors.success },
    cancelled: { bg: colors.dangerSurface, fg: colors.danger },
    blocked: { bg: colors.dangerSurface, fg: colors.danger },
    failed: { bg: colors.dangerSurface, fg: colors.danger },
  };
  const { bg, fg } = palette[status];

  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>
        {t(`alarm.status.${status}` as TranslationKey)}
      </Text>
    </View>
  );
}

function formatScheduledAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
