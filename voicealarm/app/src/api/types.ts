/** 서버 와이어 포맷(snake_case)을 그대로 반영한 타입. 변환은 화면 직전에만 한다. */

export type PublicUser = {
  id: string;
  user_id: string;
  display_name: string;
};

export type FriendRequestDirection = 'incoming' | 'outgoing';

export type FriendRequest = {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  direction: FriendRequestDirection;
  user: PublicUser;
  requested_at: string;
  responded_at: string | null;
};

export type SearchResult = {
  user: PublicUser;
  relation: {
    status: FriendRequest['status'];
    direction: FriendRequestDirection;
    request_id: string;
  } | null;
  is_self: boolean;
};

export type BlockEntry = {
  user: PublicUser;
  created_at: string;
};

export type AuthSession = {
  user: PublicUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type VoiceMessage = {
  id: string;
  duration_ms: number;
  created_at: string;
};

export type UploadTicket = {
  storage_key: string;
  upload: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expires_at: string;
  };
  max_bytes: number;
  max_duration_ms: number;
};
