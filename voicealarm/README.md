# VoiceAlarm

친구가 녹음한 목소리를 상대방 휴대폰에서 **알람으로** 울리게 하는 앱.

- 아이디/비밀번호 가입 → 아이디 정확 일치 검색 → 친구 요청 → **수락된 경우에만** 알람 전송
- 지정한 시각에 수신자 기기에서 로컬 알람이 울리고, 발신자의 녹음이 재생된다
- 수신자가 차단하면 **이미 예약된 알람도 울리지 않는다**

현재 상태: **Phase 1 (백엔드 기초) 완료.** 아래 [개발 진행 상황](#개발-진행-상황) 참고.

---

## 이 문서에서 먼저 읽어야 할 것

앱을 만들기 전에 반드시 알아야 하는 플랫폼 제약이 있습니다.
→ [플랫폼 한계](#플랫폼-한계-반드시-읽을-것) 섹션을 먼저 보세요. 특히 **iOS는 서드파티 앱이
진짜 알람 시계를 만들 수 없습니다.**

---

## 아키텍처 — "남의 폰에서 알람이 울리게" 만드는 법

푸시 알림이 **도착한 순간에 소리를 재생하는 방식은 실패합니다.** 푸시는 지연되고,
무음 모드에서 울리지 않고, 오프라인이면 아예 도착하지 않습니다.

이 프로젝트는 **사전 다운로드 + OS 로컬 알람 스케줄링** 방식을 씁니다.

```
발신자                     서버                        수신자 기기
  │ 녹음 업로드 ──────────▶ │
  │ 알람 예약 요청 ────────▶ │ 친구/차단 검증
  │                        │ ── 데이터 푸시(silent) ──▶ 알람 메타데이터 수신
  │                        │                           음성 파일 미리 다운로드
  │                        │                           OS 로컬 알람 스케줄 등록
  │                        │                                    │
  │                        │ ◀── 발화 직전 유효성 확인 ──────────│ (지정 시각)
  │                        │ ── OK/취소 ────────────────────────▶ 알람 울림 + 녹음 재생
```

핵심은 **발화 시점에 네트워크가 필요 없다**는 것입니다. 음성 파일은 예약 시점에 미리
내려받혀 있고, 알람은 OS 스케줄러에 등록돼 있습니다. 발화 직전의 서버 확인은 "차단됐는지"를
보는 것이고, 실패하면(오프라인) 기기에 남아 있는 마지막 판정을 따릅니다.

### 서버가 강제하는 3대 규칙

클라이언트 검증만으로는 부족합니다. 세 가지 모두 서버에서 강제합니다.

| 규칙 | 동작 | 코드 위치 |
|---|---|---|
| **수락 없는 전송 금지** | `status='accepted'` 친구 관계가 없으면 `403 NOT_FRIENDS` | `src/services/relationships.ts` |
| **차단 시 전송 금지** | 어느 방향이든 차단 기록이 있으면 `403 BLOCKED` | 〃 |
| **발화 시점 재검증** | 예약 시 통과했어도 발화 직전 다시 판정 | 〃 |

세 규칙의 판정 로직이 **한 함수(`evaluateSendEligibility`)에만** 있습니다.
예약 경로와 발화 경로가 각자 조건을 복사해 쓰면 언젠가 갈라지고, 갈라지는 순간
"차단했는데 울리는" 버그가 납니다. 라우트는 friendship/block 테이블을 직접 조회하지 않습니다.

---

## 플랫폼 한계 (반드시 읽을 것)

### Android — 대체로 가능하지만 제조사 이슈가 있다

| 항목 | 내용 |
|---|---|
| 정확한 알람 | `AlarmManager.setAlarmClock()` 또는 `setExactAndAllowWhileIdle()` 로 Doze 우회 |
| 권한 | Android 12+ 는 `SCHEDULE_EXACT_ALARM` 필요. 알람 시계 앱은 `USE_EXACT_ALARM` 으로 자동 부여 가능하나 **Play 스토어 심사에서 용도 소명 필요** |
| 발화 화면 | Full-screen intent + Foreground Service. Android 14+ 는 `USE_FULL_SCREEN_INTENT` 권한이 알람/통화 앱에만 자동 부여 |
| 무음 모드 | `AudioManager.STREAM_ALARM` 으로 재생하면 무음/진동 모드에서도 울림 |
| 재부팅 | 등록된 알람이 전부 사라짐 → `BOOT_COMPLETED` 리시버로 재등록 필수 |
| 배터리 최적화 | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 안내 필요 |
| **제조사** | **삼성/샤오미/화웨이/오포는 자체 절전 정책이 별도로 있어 위 설정만으로 부족합니다.** 기기별 안내 화면이 필요하고, 그래도 100%는 아닙니다 |

### iOS — 진짜 알람 시계는 만들 수 없다

**이게 이 앱의 가장 큰 제약입니다.**

| 항목 | 내용 |
|---|---|
| 알람 API | 서드파티 앱에 알람 시계 API가 **없습니다**. `UNCalendarNotificationTrigger` 기반 로컬 알림이 최선 |
| 사운드 길이 | 커스텀 알림음 **최대 30초**. 초과분은 잘림 |
| 사운드 포맷 | `caf` / `aiff` / `wav` (Linear PCM, MA4, µ-law, a-law). m4a/mp3 불가 |
| 사운드 위치 | `Library/Sounds/` 에 **미리 다운로드**돼 있어야 `UNNotificationSound(named:)` 로 재생 가능 |
| 무음 모드 | 기본적으로 **울리지 않습니다**. 뚫으려면 **Critical Alerts 엔타이틀먼트**가 필요하고, 이는 Apple에 별도 신청 후 승인받아야 합니다 (승인 보장 없음) |
| 폴백 | 승인 전에는 `Time Sensitive` 인터럽션 레벨 + 커스텀 사운드 |
| 30초 초과 녹음 | 알림을 **탭해서 앱을 열었을 때** 전체 재생하는 구조로 설계 |
| 반복/스누즈 | 알림 재예약으로 흉내내야 하며, 앱당 대기 알림 **64개 제한** |

**결론:** iOS에서는 "알람"이 아니라 "소리 나는 알림"입니다. 사용자가 방해금지 모드거나
무음이면 놓칠 수 있습니다. 이 차이를 앱 온보딩에서 솔직히 안내하는 것을 권장합니다.

### 설계에 반영된 결과

- **녹음은 30초로 제한**합니다 (iOS 알림음 상한).
- 서버는 업로드된 녹음의 **iOS용 caf 트랜스코딩본을 함께 생성**합니다
  (`voice_messages.ios_caf_key`).
- 30초 초과를 허용하려면 iOS는 "알림음 30초 + 앱 열면 전체 재생" 2단 구조가 됩니다.

---

## 개발 진행 상황

- [x] **Phase 1 — 백엔드 기초**: DB 스키마 + 마이그레이션, 인증 API, 친구/차단 API, 단위 테스트
- [ ] **Phase 2 — 앱 기초**: dev client 세팅, 로그인/회원가입, 친구 화면
- [ ] **Phase 3 — 녹음 & 업로드**: 녹음 UI, 30초 제한, presigned 업로드, caf 트랜스코딩
- [ ] **Phase 4 — 알람 파이프라인**: 예약 API → 데이터 푸시 → 사전 다운로드 → 로컬 알람 → 발화 화면 → ack
- [ ] **Phase 5 — 차단/취소 전파, 남용 방지, 신고**
- [ ] **Phase 6 — 권한 온보딩, 재부팅 복구, 배포 설정**

### Phase 1 에서 만든 것

```
voicealarm/server/
├── prisma/
│   ├── schema.prisma            # 전체 데이터 모델 (알람/음성 테이블 포함)
│   └── migrations/              # init 마이그레이션
├── scripts/
│   ├── dev-db.sh                # 로컬 Postgres 클러스터 (docker 불필요)
│   └── test.sh                  # 테스트 DB 준비 + vitest 실행
├── src/
│   ├── app.ts                   # Fastify 조립, 에러 핸들러
│   ├── config/env.ts            # 환경변수 검증 (부팅 시점)
│   ├── lib/                     # errors, password(argon2id), tokens(JWT+회전), validation, serialize
│   ├── modules/                 # auth / devices / friends / blocks 라우트
│   ├── plugins/                 # auth(requireAuth), prisma
│   └── services/
│       ├── relationships.ts     # ★ 3대 규칙 판정 (전송/발화 공통)
│       ├── loginThrottle.ts     # 로그인 브루트포스 백오프
│       └── push.ts              # 푸시 전송 경계 (Phase 4 에서 FCM 연결)
└── tests/                       # 41개 테스트
```

---

## 실행 방법

### 요구사항

- Node.js 20 이상
- PostgreSQL 16 (로컬 설치본 사용, Docker 불필요)

### 설치 및 실행

```bash
cd voicealarm/server
npm install

# 로컬 Postgres 클러스터 기동 (voicealarm / voicealarm_test DB 자동 생성)
npm run db:up

cp .env.example .env
# .env 의 JWT_SECRET 을 실제 값으로 교체:  openssl rand -base64 48

npm run prisma:generate
npm run prisma:migrate     # 개발용. 운영은 npm run prisma:deploy

npm run dev                # http://localhost:3000
```

### 테스트

```bash
npm test
```

테스트는 **실제 Postgres**(`voicealarm_test` DB)에 대해 돌아갑니다. 인메모리 스텁을 쓰지 않는
이유는, 검증 대상이 "친구 수락 없이는 못 보낸다 / 차단하면 못 보낸다" 같은 관계 규칙이고
그 규칙이 UNIQUE 제약과 트랜잭션 동작에 의존하기 때문입니다.

```
✓ tests/relationships.test.ts  (13) — 3대 규칙
✓ tests/auth.test.ts            (9) — 해싱, 회전, 브루트포스, 계정 은닉
✓ tests/friends.test.ts         (9) — 요청/수락/거절/삭제, 정확 일치 검색
✓ tests/blocks.test.ts         (10) — 차단 전파, 예약 알람 취소, 차단 은닉
```

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | — | Postgres 연결 문자열 (필수) |
| `JWT_SECRET` | — | **32자 이상 필수.** 짧으면 부팅이 실패합니다 |
| `ACCESS_TOKEN_TTL_SEC` | `900` | access 토큰 15분 |
| `REFRESH_TOKEN_TTL_SEC` | `2592000` | refresh 토큰 30일 |
| `LOGIN_FAIL_THRESHOLD` | `5` | 이 횟수부터 지수 백오프 |
| `LOGIN_LOCK_BASE_SEC` | `30` | 첫 잠금 시간 (이후 2배씩) |
| `LOGIN_LOCK_MAX_SEC` | `3600` | 잠금 상한 |
| `CORS_ORIGIN` | `*` | 쉼표 구분. 운영에서는 반드시 좁힐 것 |

---

## API (Phase 1 구현분)

요청·응답은 모두 `snake_case`. 에러는 `{ "error": { "code", "message" } }` 형태이며
클라이언트는 `message` 가 아니라 **`code` 로 분기**합니다.

### 인증

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/auth/signup` | `{ user_id, password, display_name }`. 아이디 3~20자, 비밀번호 8자 이상 |
| `POST` | `/auth/login` | `{ user_id, password }` → access/refresh |
| `POST` | `/auth/refresh` | `{ refresh_token }` → 회전된 새 토큰 쌍 |
| `POST` | `/auth/logout` | `{ refresh_token }` 폐기 |
| `GET` | `/auth/me` | 본인 정보 |
| `POST` | `/devices` | 푸시 토큰 등록/갱신 |
| `DELETE` | `/devices` | 푸시 토큰 해제 |

### 친구

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/users/search?user_id=` | **정확 일치만.** 부분 검색은 스토킹 경로라 제공하지 않음 |
| `POST` | `/friends/requests` | `{ target_user_id }` → pending |
| `GET` | `/friends/requests?direction=incoming\|outgoing` | 요청 목록 |
| `POST` | `/friends/requests/:id/accept` | 수신자만 |
| `POST` | `/friends/requests/:id/reject` | 수신자만 |
| `DELETE` | `/friends/requests/:id` | 발신자 취소 |
| `GET` | `/friends` | 수락된 친구 목록 |
| `DELETE` | `/friends/:userId` | 친구 삭제 + 양방향 예약 알람 취소 |

### 차단

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/blocks` | 차단 + 예약 알람 `blocked` 전환 + 취소 푸시 |
| `DELETE` | `/blocks/:userId` | 차단 해제 |
| `GET` | `/blocks` | 내가 차단한 목록 |

### Phase 4 에서 추가될 것

`/voice-messages/upload-url`, `/voice-messages`, `POST /alarms`, `GET /alarms`,
`DELETE /alarms/:id`, `GET /alarms/:id/validity`, `POST /alarms/:id/ack`, `POST /reports`

---

## 보안·프라이버시 설계 노트

몇 가지는 스펙보다 한 발 더 나갔거나, 의도적으로 다르게 했습니다.

**차단 사실 은닉.** 차단당한 쪽에게는 상대가 **존재하지 않는 것처럼** 보입니다.
검색·친구 요청 모두 `404 USER_NOT_FOUND`. 403을 주면 "차단당했다"가 드러나고,
그게 오프라인 보복으로 이어질 수 있습니다.

**단, 알람 전송은 예외.** 스펙대로 `403 BLOCKED` 를 그대로 돌려줍니다. 이 경로는 이미
친구였던 사이에서만 도달 가능하므로 노출 범위가 제한적입니다. 이것도 숨기고 싶으면
`NOT_FRIENDS` 로 통일하면 됩니다 — `relationships.ts` 한 줄 변경입니다.

**친구가 아니면서 차단된 경우**는 `NOT_FRIENDS` 가 먼저 나갑니다(검사 순서가 친구 → 차단).
결과적으로 차단 사실이 가려집니다.

**refresh 토큰은 JWT가 아닙니다.** 불투명한 난수를 SHA-256 해시로 저장합니다.
서버가 폐기를 즉시 강제할 수 있어야 하기 때문입니다. 회전된 토큰이 다시 들어오면
탈취로 간주하고 해당 사용자의 **모든** 토큰을 폐기합니다.

**로그인 계정 은닉.** 없는 아이디로 로그인해도 더미 해시로 argon2 검증 비용을 한 번 치릅니다.
응답 시간과 응답 본문이 모두 동일해서 계정 존재 여부를 알아낼 수 없습니다.

**차단 해제 시 알람은 되살리지 않습니다.** 해제하는 순간 과거 시각의 알람이 한꺼번에
울리는 사고를 막기 위해서입니다. 친구 관계 자체는 복구됩니다.

**차단은 단방향 기록, 양방향 효과.** `blocks` 행은 스펙대로 `blocker → blocked` 하나만
만들지만, 전송 판정은 양방향으로 봅니다. 차단해 놓고 자기는 계속 보내는 걸 막습니다.

---

## 내가(사용자가) 직접 해야 하는 일

Phase 1 에서는 없습니다. 아래는 **Phase 4 시작 전까지** 준비가 필요한 항목입니다.

### Android / FCM
- [ ] Firebase 프로젝트 생성
- [ ] Android 앱 등록 → `google-services.json` 다운로드
- [ ] 서버용 서비스 계정 키 발급 (FCM v1 API)

### iOS / APNs
- [ ] Apple Developer Program 가입 (연 $99)
- [ ] App ID 생성, Push Notifications capability 활성화
- [ ] APNs 인증 키(.p8) 발급 → Firebase 콘솔에 업로드
- [ ] **Critical Alerts 엔타이틀먼트 신청** — Apple 승인까지 시간이 걸리므로 **가장 먼저 신청**하세요.
      (developer.apple.com → Contact us → Critical Alerts 요청)
- [ ] 실기기 1대 이상 (시뮬레이터에서는 푸시·알람 테스트 불가)

### 스토어 심사 대비
- [ ] Android: `USE_EXACT_ALARM` 사용 사유 소명 (알람 시계 기능이 핵심임을 설명)
- [ ] 개인정보처리방침 URL (음성 녹음을 다루므로 필수)
- [ ] 이 앱은 괴롭힘 도구가 될 수 있으므로 **신고/차단 기능이 심사에서 확인**됩니다 (Phase 5)

---

## 라이선스

Private.
