import type { ApiClient } from './client';
import type {
  AuthSession,
  BlockEntry,
  FriendRequest,
  FriendRequestDirection,
  PublicUser,
  SearchResult,
  UploadTicket,
  VoiceMessage,
} from './types';

/**
 * 엔드포인트 래퍼. 화면 코드가 경로 문자열과 snake_case 바디를 직접 다루지 않게 한다.
 * 서버 스펙이 바뀌면 여기만 고치면 된다.
 */
export const api = {
  auth: {
    signup(client: ApiClient, input: { userId: string; password: string; displayName: string }) {
      return client.post<AuthSession>('/auth/signup', {
        auth: false,
        body: {
          user_id: input.userId,
          password: input.password,
          display_name: input.displayName,
        },
      });
    },

    login(client: ApiClient, input: { userId: string; password: string }) {
      return client.post<AuthSession>('/auth/login', {
        auth: false,
        body: { user_id: input.userId, password: input.password },
      });
    },

    logout(client: ApiClient, refreshToken: string) {
      return client.post<{ ok: true }>('/auth/logout', {
        auth: false,
        body: { refresh_token: refreshToken },
      });
    },

    me(client: ApiClient) {
      return client.get<{ user: PublicUser }>('/auth/me');
    },
  },

  users: {
    search(client: ApiClient, userId: string) {
      return client.get<SearchResult>('/users/search', { query: { user_id: userId } });
    },
  },

  friends: {
    list(client: ApiClient) {
      return client.get<{ friends: PublicUser[] }>('/friends');
    },

    requests(client: ApiClient, direction: FriendRequestDirection) {
      return client.get<{ requests: FriendRequest[] }>('/friends/requests', {
        query: { direction },
      });
    },

    sendRequest(client: ApiClient, targetUserId: string) {
      return client.post<{ request: FriendRequest }>('/friends/requests', {
        body: { target_user_id: targetUserId },
      });
    },

    accept(client: ApiClient, requestId: string) {
      return client.post<{ request: FriendRequest }>(`/friends/requests/${requestId}/accept`);
    },

    reject(client: ApiClient, requestId: string) {
      return client.post<{ request: FriendRequest }>(`/friends/requests/${requestId}/reject`);
    },

    cancelRequest(client: ApiClient, requestId: string) {
      return client.delete<{ ok: true }>(`/friends/requests/${requestId}`);
    },

    remove(client: ApiClient, userUuid: string) {
      return client.delete<{ ok: true }>(`/friends/${userUuid}`);
    },
  },

  voiceMessages: {
    createUploadUrl(client: ApiClient, mimeType: string) {
      return client.post<UploadTicket>('/voice-messages/upload-url', {
        body: { mime_type: mimeType },
      });
    },

    /** 길이를 보내지 않는 건 의도다 — 서버가 실제 파일을 재서 판단한다. */
    register(client: ApiClient, storageKey: string) {
      return client.post<{ voice_message: VoiceMessage }>('/voice-messages', {
        body: { storage_key: storageKey },
      });
    },

    downloadUrl(client: ApiClient, id: string, variant: 'original' | 'ios' = 'original') {
      return client.get<{ url: string; expires_at: string; duration_ms: number }>(
        `/voice-messages/${id}/download-url`,
        { query: { variant } },
      );
    },

    remove(client: ApiClient, id: string) {
      return client.delete<{ ok: true }>(`/voice-messages/${id}`);
    },
  },

  blocks: {
    list(client: ApiClient) {
      return client.get<{ blocks: BlockEntry[] }>('/blocks');
    },

    create(client: ApiClient, targetUserId: string) {
      return client.post<{ block: { user: PublicUser }; cancelled_alarm_count: number }>('/blocks', {
        body: { target_user_id: targetUserId },
      });
    },

    remove(client: ApiClient, userUuid: string) {
      return client.delete<{ ok: true }>(`/blocks/${userUuid}`);
    },
  },
};
