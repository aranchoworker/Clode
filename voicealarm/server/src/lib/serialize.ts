/**
 * 와이어 포맷은 스펙의 요청 바디를 따라 snake_case 로 통일한다.
 * DB 모델을 그대로 반환하면 password_hash 같은 필드가 실려 나갈 수 있으므로
 * 응답으로 나가는 객체는 반드시 여기를 거친다.
 */

export type PublicUserInput = {
  id: string;
  userId: string;
  displayName: string;
};

export type PublicUser = {
  id: string;
  user_id: string;
  display_name: string;
};

export function publicUser(user: PublicUserInput): PublicUser {
  return { id: user.id, user_id: user.userId, display_name: user.displayName };
}

export type FriendshipInput = {
  id: string;
  status: string;
  requestedAt: Date;
  respondedAt: Date | null;
  requester: PublicUserInput;
  addressee: PublicUserInput;
};

export function friendRequest(row: FriendshipInput, viewerId: string) {
  const counterpart = row.requester.id === viewerId ? row.addressee : row.requester;
  return {
    id: row.id,
    status: row.status,
    direction: row.requester.id === viewerId ? 'outgoing' : 'incoming',
    user: publicUser(counterpart),
    requested_at: row.requestedAt.toISOString(),
    responded_at: row.respondedAt?.toISOString() ?? null,
  };
}
