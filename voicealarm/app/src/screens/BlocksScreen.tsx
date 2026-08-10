import { useState } from 'react';
import { Alert, FlatList, RefreshControl } from 'react-native';
import { api } from '../api/endpoints';
import type { BlockEntry } from '../api/types';
import { useSession } from '../auth/AuthContext';
import { Button, EmptyState, ErrorBanner, Loading, Screen, UserRow } from '../components';
import { useI18n } from '../i18n/context';
import { useAsync } from '../lib/useAsync';
import { useTheme } from '../theme';

export function BlocksScreen() {
  const { t } = useI18n();
  const { spacing } = useTheme();
  const { client } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(() => api.blocks.list(client), [client]);

  function confirmUnblock(entry: BlockEntry) {
    Alert.alert(
      t('blocks.unblock'),
      t('blocks.unblock.confirm', { name: entry.user.display_name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('blocks.unblock'),
          onPress: async () => {
            setBusyId(entry.user.id);
            try {
              await api.blocks.remove(client, entry.user.id);
              await reload();
            } catch (caught) {
              Alert.alert(caught instanceof Error ? caught.message : t('common.error.unknown'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  if (loading && !data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={data?.blocks ?? []}
        keyExtractor={(item) => item.user.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
        ListHeaderComponent={<ErrorBanner error={error} />}
        ListEmptyComponent={<EmptyState message={t('blocks.empty')} />}
        renderItem={({ item }) => (
          <UserRow
            displayName={item.user.display_name}
            userId={item.user.user_id}
            actions={
              <Button
                label={t('blocks.unblock')}
                variant="secondary"
                compact
                disabled={busyId === item.user.id}
                onPress={() => confirmUnblock(item)}
              />
            }
          />
        )}
      />
    </Screen>
  );
}
