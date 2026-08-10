import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { SearchResult } from '../api/types';
import { useSession } from '../auth/AuthContext';
import { Button, ErrorBanner, Heading, Muted, Screen, TextField, UserRow } from '../components';
import { useI18n } from '../i18n/context';
import { useTheme } from '../theme';

/**
 * 아이디 정확 일치 검색 → 친구 요청.
 *
 * 서버가 부분 검색을 제공하지 않으므로 자동완성·추천 목록이 없다.
 * 이건 제약이 아니라 의도된 설계라서(스토킹 방지) 화면에도 그 이유를 안내한다.
 */
export function AddFriendScreen() {
  const { t } = useI18n();
  const { colors, spacing } = useTheme();
  const { client, user: me } = useSession();

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;

    setSearching(true);
    setError(null);
    setNotFound(false);
    setResult(null);
    setSentTo(null);

    try {
      setResult(await api.users.search(client, trimmed));
    } catch (caught) {
      // 404 는 "없는 사용자" 또는 "차단 관계"다. 둘을 구분해서 보여주면
      // 차단 사실이 드러나므로 서버와 똑같이 하나로 취급한다.
      if (caught instanceof ApiError && caught.status === 404) {
        setNotFound(true);
      } else {
        setError(caught);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleSendRequest(targetUserId: string) {
    setSending(true);
    setError(null);
    try {
      await api.friends.sendRequest(client, targetUserId);
      setSentTo(targetUserId);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen scroll>
      <Heading>{t('search.title')}</Heading>

      <ErrorBanner error={error} />

      <TextField
        label={t('auth.field.userId')}
        placeholder={t('search.placeholder')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => void handleSearch()}
      />

      <Button
        label={t('search.submit')}
        onPress={() => void handleSearch()}
        disabled={query.trim().length < 3}
        loading={searching}
      />

      <View style={{ marginTop: spacing.md }}>
        <Muted>{t('search.hint')}</Muted>
      </View>

      {notFound ? (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>{t('search.notFound')}</Text>
        </View>
      ) : null}

      {result ? (
        <View style={{ marginTop: spacing.xl }}>
          <UserRow
            displayName={result.user.display_name}
            userId={result.user.user_id}
            actions={
              <SearchAction
                result={result}
                isSelf={result.user.id === me.id}
                sent={sentTo === result.user.user_id}
                sending={sending}
                onSend={() => void handleSendRequest(result.user.user_id)}
              />
            }
          />
          <StatusNote result={result} isSelf={result.user.id === me.id} sent={sentTo !== null} />
        </View>
      ) : null}
    </Screen>
  );
}

function SearchAction({
  result,
  isSelf,
  sent,
  sending,
  onSend,
}: {
  result: SearchResult;
  isSelf: boolean;
  sent: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const { t } = useI18n();

  // 본인이거나, 이미 친구이거나, 이미 요청이 오간 상태면 버튼을 내린다.
  const alreadyHandled =
    isSelf || sent || result.relation?.status === 'accepted' || result.relation?.status === 'pending';

  if (alreadyHandled) return null;

  return <Button label={t('search.sendRequest')} compact onPress={onSend} loading={sending} />;
}

function StatusNote({
  result,
  isSelf,
  sent,
}: {
  result: SearchResult;
  isSelf: boolean;
  sent: boolean;
}) {
  const { t } = useI18n();
  const { colors, spacing } = useTheme();

  const message = (() => {
    if (isSelf) return t('search.self');
    if (sent) return t('search.requestSent');
    if (result.relation?.status === 'accepted') return t('search.status.accepted');
    if (result.relation?.status === 'pending') {
      return result.relation.direction === 'outgoing'
        ? t('search.status.pending.outgoing')
        : t('search.status.pending.incoming');
    }
    return null;
  })();

  if (!message) return null;

  return (
    <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: spacing.sm }}>{message}</Text>
  );
}
