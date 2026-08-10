import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/endpoints';
import type { FriendRequest, PublicUser } from '../api/types';
import { useSession } from '../auth/AuthContext';
import {
  Button,
  EmptyState,
  ErrorBanner,
  Heading,
  Loading,
  Screen,
  SegmentedTabs,
  UserRow,
} from '../components';
import { useI18n } from '../i18n/context';
import { useAsync } from '../lib/useAsync';
import { useTheme } from '../theme';

type Tab = 'friends' | 'incoming' | 'outgoing';

export function FriendsScreen({ onAddFriend }: { onAddFriend: () => void }) {
  const { t } = useI18n();
  const { spacing } = useTheme();
  const { client } = useSession();
  const [tab, setTab] = useState<Tab>('friends');
  const [busyId, setBusyId] = useState<string | null>(null);

  // 세 목록을 한 번에 가져온다. 받은 요청 뱃지를 항상 정확히 보여주려면
  // 어느 탭에 있든 incoming 개수를 알아야 한다.
  const { data, error, loading, reload } = useAsync(async () => {
    const [friends, incoming, outgoing] = await Promise.all([
      api.friends.list(client),
      api.friends.requests(client, 'incoming'),
      api.friends.requests(client, 'outgoing'),
    ]);
    return {
      friends: friends.friends,
      incoming: incoming.requests,
      outgoing: outgoing.requests,
    };
  }, [client]);

  // 친구 추가 화면에서 요청을 보내고 돌아오면 목록이 최신이어야 한다.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await reload();
    } catch (caught) {
      Alert.alert(
        t('common.error.unknown'),
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmRemove(friend: PublicUser) {
    Alert.alert(t('friends.remove'), t('friends.remove.confirm', { name: friend.display_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('friends.remove'),
        style: 'destructive',
        onPress: () => void run(friend.id, () => api.friends.remove(client, friend.id)),
      },
    ]);
  }

  function confirmBlock(user: PublicUser) {
    Alert.alert(t('friends.block'), t('friends.block.confirm', { name: user.display_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('friends.block'),
        style: 'destructive',
        onPress: () =>
          void run(user.id, async () => {
            const result = await api.blocks.create(client, user.user_id);
            // 예약돼 있던 알람이 함께 취소됐다는 사실을 반드시 알려준다.
            // 차단의 효과 범위를 사용자가 정확히 알아야 하는 부분이다.
            const suffix =
              result.cancelled_alarm_count > 0
                ? `\n${t('friends.blocked.alarmsCancelled', { count: result.cancelled_alarm_count })}`
                : '';
            Alert.alert(t('friends.blocked.done', { name: user.display_name }) + suffix);
          }),
      },
    ]);
  }

  const incomingCount = data?.incoming.length ?? 0;

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Heading>{t('friends.title')}</Heading>
          <View style={{ marginBottom: spacing.lg }}>
            <Button label={t('friends.add')} onPress={onAddFriend} compact variant="secondary" />
          </View>
        </View>

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'friends', label: t('friends.tab.friends') },
            { value: 'incoming', label: t('friends.tab.incoming'), badge: incomingCount },
            { value: 'outgoing', label: t('friends.tab.outgoing') },
          ]}
        />

        <ErrorBanner error={error} />
      </View>

      {loading && !data ? (
        <Loading />
      ) : tab === 'friends' ? (
        <FlatList
          data={data?.friends ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
          ListEmptyComponent={<EmptyState message={t('friends.empty')} />}
          renderItem={({ item }) => (
            <UserRow
              displayName={item.display_name}
              userId={item.user_id}
              actions={
                <>
                  <Button
                    label={t('friends.block')}
                    variant="danger"
                    compact
                    disabled={busyId === item.id}
                    onPress={() => confirmBlock(item)}
                  />
                  <Button
                    label={t('friends.remove')}
                    variant="secondary"
                    compact
                    disabled={busyId === item.id}
                    onPress={() => confirmRemove(item)}
                  />
                </>
              }
            />
          )}
        />
      ) : (
        <RequestList
          requests={tab === 'incoming' ? (data?.incoming ?? []) : (data?.outgoing ?? [])}
          emptyMessage={
            tab === 'incoming' ? t('friends.empty.incoming') : t('friends.empty.outgoing')
          }
          refreshing={loading}
          onRefresh={() => void reload()}
          busyId={busyId}
          actionsFor={(request) =>
            tab === 'incoming' ? (
              <>
                <Button
                  label={t('friends.accept')}
                  compact
                  disabled={busyId === request.id}
                  onPress={() => void run(request.id, () => api.friends.accept(client, request.id))}
                />
                <Button
                  label={t('friends.reject')}
                  variant="secondary"
                  compact
                  disabled={busyId === request.id}
                  onPress={() => void run(request.id, () => api.friends.reject(client, request.id))}
                />
              </>
            ) : (
              <Button
                label={t('friends.cancelRequest')}
                variant="secondary"
                compact
                disabled={busyId === request.id}
                onPress={() =>
                  void run(request.id, () => api.friends.cancelRequest(client, request.id))
                }
              />
            )
          }
        />
      )}
    </Screen>
  );
}

function RequestList({
  requests,
  emptyMessage,
  refreshing,
  onRefresh,
  actionsFor,
}: {
  requests: FriendRequest[];
  emptyMessage: string;
  refreshing: boolean;
  onRefresh: () => void;
  busyId: string | null;
  actionsFor: (request: FriendRequest) => React.ReactNode;
}) {
  const { spacing } = useTheme();

  return (
    <FlatList
      data={requests}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<EmptyState message={emptyMessage} />}
      renderItem={({ item }) => (
        <UserRow
          displayName={item.user.display_name}
          userId={item.user.user_id}
          actions={actionsFor(item)}
        />
      )}
    />
  );
}
