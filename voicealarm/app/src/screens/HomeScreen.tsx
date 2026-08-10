import { useState } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, Heading, Muted, Screen, SegmentedTabs } from '../components';
import { useI18n } from '../i18n/context';
import { useTheme } from '../theme';

type Tab = 'received' | 'sent';

/**
 * 알람 목록 화면의 껍데기.
 *
 * 목록 API(GET /alarms)와 알람 만들기는 Phase 4 에 붙는다. 지금 화면을 미리 두는 이유는
 * 탭 구조와 진입 경로를 확정해 두면 Phase 4 가 화면 배치가 아니라 알람 파이프라인에만
 * 집중할 수 있기 때문이다.
 */
export function HomeScreen({ onCreateAlarm }: { onCreateAlarm?: () => void }) {
  const { t } = useI18n();
  const { spacing } = useTheme();
  const [tab, setTab] = useState<Tab>('received');

  return (
    <Screen>
      <Heading>{t('home.title')}</Heading>

      <SegmentedTabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'received', label: t('home.tab.received') },
          { value: 'sent', label: t('home.tab.sent') },
        ]}
      />

      <EmptyState message={t('home.empty')} />

      <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
        <Muted>{t('home.comingSoon')}</Muted>
      </View>

      {onCreateAlarm ? (
        <View style={{ marginTop: spacing.xl }}>
          <Button label={t('home.record')} onPress={onCreateAlarm} variant="secondary" />
        </View>
      ) : null}
    </Screen>
  );
}
