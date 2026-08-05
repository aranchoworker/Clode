# ☂️ 우산 알림 (Umbrella)

현재 위치의 오늘 강수확률을 조회해, 임계값(기본 55%) 이상이면 홈 화면·잠금화면
위젯에 **"우산 챙기세요"** 를 강조 표시하고 아침에 알림을 보내는 iOS 앱입니다.

- **날씨**: [Open-Meteo](https://open-meteo.com) — API 키·계정 불필요
- **위치**: CoreLocation, "앱을 사용하는 동안" 권한만 사용 (**'항상 허용' 요구 안 함**)
- **최소 버전**: iOS 17.0 / Swift 5.9+ / Xcode 15 이상

---

## 목차

1. [빠른 시작](#빠른-시작)
2. [Xcode에서 App Group 설정하기](#xcode에서-app-group-설정하기)
3. [식별자 바꾸기](#식별자-바꾸기)
4. [권한 목록](#권한-목록)
5. [위젯 추가 방법](#위젯-추가-방법)
6. [갱신 주기와 제한 사항](#갱신-주기와-제한-사항)
7. [판정 규칙](#판정-규칙)
8. [프로젝트 구조](#프로젝트-구조)
9. [테스트](#테스트)
10. [알려진 제한](#알려진-제한)

---

## 빠른 시작

```bash
open Umbrella.xcodeproj
```

1. `UmbrellaApp` 타깃 → **Signing & Capabilities** 에서 본인 팀 선택
2. `UmbrellaWidgetExtension` 타깃에도 같은 팀 선택
3. 두 타깃 모두에 **App Groups** 를 추가 (아래 참고)
4. 스킴 `UmbrellaApp` 선택 후 실행

> 시뮬레이터에서도 동작하지만, 위치는 **Features → Location** 에서 임의 좌표를
> 지정해야 하고 백그라운드 갱신은 실제 기기에서만 의미 있게 동작합니다.

---

## Xcode에서 App Group 설정하기

앱과 위젯은 **같은 App Group** 의 `UserDefaults` 를 통해 설정값과 캐시를
주고받습니다. 이 설정이 빠지면 앱은 실행되지만 위젯이 설정을 읽지 못합니다.
(앱 홈 화면 상단에 경고 배너가 뜨고, 설정 화면의 `App Group` 항목이 `미설정`
으로 표시됩니다.)

### 1. 앱 타깃

1. 프로젝트 네비게이터에서 **Umbrella** 프로젝트 선택
2. **TARGETS → UmbrellaApp** 선택
3. **Signing & Capabilities** 탭 → 좌측 상단 **+ Capability**
4. **App Groups** 를 더블클릭해 추가
5. App Groups 목록에서 **+** 를 눌러 다음 값을 입력

   ```
   group.com.example.umbrella
   ```

6. 체크박스가 켜져 있는지 확인

### 2. 위젯 타깃

1. **TARGETS → UmbrellaWidgetExtension** 선택
2. 위와 똑같이 **App Groups** 추가
3. 목록에 이미 나타나는 `group.com.example.umbrella` 의 **체크박스를 켜기**
   (새로 만들지 말고 같은 것을 선택해야 합니다)

### 3. 확인

두 타깃의 entitlements 파일이 아래와 같이 **동일한** 값을 갖고 있으면 됩니다.

| 파일 | 키 | 값 |
| --- | --- | --- |
| `UmbrellaApp/UmbrellaApp.entitlements` | `com.apple.security.application-groups` | `group.com.example.umbrella` |
| `UmbrellaWidget/UmbrellaWidget.entitlements` | `com.apple.security.application-groups` | `group.com.example.umbrella` |

> **주의** — App Group 식별자는 Apple Developer 계정에 등록된 것이어야 합니다.
> 자동 서명(Automatic signing)을 쓰면 Xcode가 등록까지 처리해 주지만, 조직 계정
> 에서는 관리자 권한이 필요할 수 있습니다.

---

## 식별자 바꾸기

번들 ID와 App Group 식별자는 **`Shared/AppConstants.swift` 한 곳**에만 정의돼
있습니다. 포크해서 쓸 때는 다음 네 곳을 같은 값으로 맞추세요.

| 위치 | 항목 |
| --- | --- |
| `Shared/AppConstants.swift` | `appBundleIdentifier`, `widgetBundleIdentifier`, `appGroupIdentifier`, `backgroundRefreshTaskIdentifier`, `urlScheme` |
| Xcode 빌드 설정 | 두 타깃의 `PRODUCT_BUNDLE_IDENTIFIER` |
| `*.entitlements` (2개) | `com.apple.security.application-groups` |
| `UmbrellaApp/Info.plist` | `BGTaskSchedulerPermittedIdentifiers`, `CFBundleURLTypes` |

지켜야 할 규칙:

- 위젯 번들 ID는 반드시 앱 번들 ID로 시작해야 합니다
  (`com.example.umbrella` → `com.example.umbrella.widget`)
- App Group 식별자는 `group.` 으로 시작해야 합니다

---

## 권한 목록

| 권한 | 키 | 어디에 | 왜 필요한가 | 없으면 |
| --- | --- | --- | --- | --- |
| 위치 (앱 사용 중) | `NSLocationWhenInUseUsageDescription` | 앱 + 위젯 Info.plist | 현재 위치의 강수확률 조회 | App Group에 저장된 마지막 좌표로 폴백, 그것도 없으면 "정보 없음" |
| 위젯 위치 | `NSWidgetWantsLocation` | 앱 + 위젯 Info.plist | 위젯 확장이 직접 위치를 받도록 허용 | 위젯은 앱이 저장한 좌표만 사용 |
| 알림 | 런타임 요청 (`UNUserNotificationCenter`) | — | 아침 우산 알림 | 위젯은 정상 동작, 알림만 안 옴 |
| 백그라운드 갱신 | `BGTaskSchedulerPermittedIdentifiers`, `UIBackgroundModes: fetch` | 앱 Info.plist | 새벽에 데이터를 미리 받아두기 | 앱을 열 때만 갱신됨 |

**'항상 허용'(`NSLocationAlwaysAndWhenInUseUsageDescription`)은 요청하지 않습니다.**
위젯은 `NSWidgetWantsLocation` 을 통해 별도로 위치를 받으며, 코드에서
`CLLocationManager.isAuthorizedForWidgetUpdates` 를 반드시 확인한 뒤에만
위치를 요청합니다 (`Shared/LocationProvider.swift` 의
`resolveCoordinateForWidget`).

---

## 위젯 추가 방법

### 홈 화면 (systemSmall / systemMedium)

1. 앱을 **한 번 실행**해 위치 권한을 허용합니다 (위젯은 앱의 권한을 물려받습니다)
2. 홈 화면 빈 곳을 길게 누릅니다
3. 좌측 상단 **+** → 검색창에 `우산 알림` 입력
4. **작게(Small)** 또는 **중간(Medium)** 을 선택 → **위젯 추가**

### 잠금화면 (accessoryRectangular / accessoryInline)

1. 잠금화면을 길게 누른 뒤 **사용자화 → 잠금 화면**
2. 시계 아래 영역을 탭하면 `accessoryRectangular`,
   시계 위 한 줄 영역을 탭하면 `accessoryInline` 자리입니다
3. `우산 알림` 을 선택

위젯을 탭하면 `umbrella://refresh` 딥링크로 앱이 열리고, **즉시 재조회 후
타임라인을 리로드**합니다.

---

## 갱신 주기와 제한 사항

> **위젯은 실시간이 아닙니다.** iOS가 위젯 갱신 횟수를 제한하기 때문에, 하루에
> 몇 차례만 새 데이터를 받습니다. 그래서 모든 위젯 패밀리에 **"마지막 갱신
> 07:12"** 를 항상 표시합니다 — 화면의 숫자가 언제 받은 값인지 그 시각으로
> 판단하세요.

### 무엇이 언제 일어나는가

| 계기 | 하는 일 |
| --- | --- |
| 타임라인 빌드 | 위치 → Open-Meteo 조회 → 판정 → App Group에 캐시 |
| 타임라인 엔트리 | 현재 시각부터 **2시간 간격**으로 22:00까지, 그 다음은 **다음날 06:30** |
| 리로드 요청 | `.after(다음 2시간 지점)` — 여기서 실제 재조회가 일어납니다 |
| `BGAppRefreshTask` | 알림 시각 **90분 전**(기본 05:30)에 미리 조회 → 알림 예약 → `reloadAllTimelines()` |
| 앱 포그라운드 진입 | 캐시가 30분보다 오래됐으면 재조회 |
| 위젯 탭 | 앱이 열리며 즉시 재조회 |

밤 22:00~06:30 사이에는 엔트리를 만들지 않습니다. 자정을 넘긴 뒤 **첫 엔트리는
06:30** 이라, 아침에 처음 화면을 볼 때는 갱신된 상태입니다.

### iOS가 지키지 않을 수 있는 것들

- `BGAppRefreshTask` 의 `earliestBeginDate` 는 **희망 시각일 뿐**입니다. 기기
  사용 패턴, 배터리, 저전력 모드에 따라 늦게 실행되거나 아예 실행되지 않습니다.
- 위젯 타임라인 리로드 역시 시스템 예산 안에서만 허용됩니다.
- 저전력 모드에서는 백그라운드 갱신이 대체로 중단됩니다.

이 때문에 코드는 **갱신이 전혀 일어나지 않아도 무너지지 않도록** 작성돼
있습니다: 네트워크가 실패하면 캐시된 마지막 결과를 원래의 조회 시각과 함께
보여주고(`SnapshotFallback`), 위젯에는 오프라인 표시가 함께 나타납니다.

---

## 판정 규칙

`Shared/UmbrellaDecision.swift` 의 순수 함수 하나가 모든 판정을 담당합니다.

1. Open-Meteo 응답의 `hourly.time` / `hourly.precipitation_probability` 를 읽습니다.
2. **예보 지점의 시간대 기준** 오늘 날짜에 해당하는 행만 남깁니다.
   (기기 시간대가 아니라 응답의 `utc_offset_seconds` 를 씁니다 — 해외에 있거나
   자정 전후일 때 어제 값을 보게 되는 문제를 막습니다.)
3. 그중 **06:00 ~ 22:00** 구간의 **최댓값**을 구합니다. `null` 은 0이 아니라
   **건너뜁니다**.
4. 최댓값이 임계값 **이상**이면 `우산 챙기세요`, 미만이면 `우산 필요 없어요`.
   쓸 수 있는 값이 하나도 없으면 `정보 없음` (임계값이 0이어도 우산을
   권하지 않습니다).

| 최댓값 | 임계값 | 결과 |
| --- | --- | --- |
| 54% | 55% | 우산 필요 없어요 · 54% |
| 55% | 55% | **우산 챙기세요 · 55%** |
| 56% | 55% | **우산 챙기세요 · 56%** |
| 없음(빈 배열 / 전부 null) | 무관 | 정보 없음 · -- |

---

## 프로젝트 구조

```
Umbrella.xcodeproj/         앱 + 위젯 + 테스트 타깃
project.yml                 XcodeGen 명세 (프로젝트 재생성용, 빌드에는 불필요)
Package.swift               순수 로직만 뽑아낸 SwiftPM 패키지 (CI/테스트용)

UmbrellaApp/                메인 앱
  UmbrellaAppApp.swift        @main, 딥링크 처리, 씬 생명주기
  OnboardingView.swift        권한 온보딩
  HomeView.swift              오늘의 판정 카드
  SettingsView.swift          임계값 / 알림 시간 / 알림 on-off
  AppModel.swift              관찰 가능한 앱 상태
  NotificationScheduler.swift 조건부 아침 알림
  BackgroundRefreshScheduler.swift  BGAppRefreshTask 등록·예약
  Info.plist                  권한 문구, BGTask ID, URL scheme
  UmbrellaApp.entitlements    App Group

UmbrellaWidget/             Widget Extension
  UmbrellaWidgetBundle.swift  @main, Widget 선언, 지원 패밀리
  UmbrellaProvider.swift      TimelineProvider
  UmbrellaEntry.swift         TimelineEntry
  UmbrellaWidgetView.swift    4개 패밀리 레이아웃 + 프리뷰
  Info.plist                  NSWidgetWantsLocation
  UmbrellaWidget.entitlements App Group

Shared/                     두 타깃 모두에 포함
  AppConstants.swift          번들 ID / App Group / 기본값 — 유일한 출처
  WeatherService.swift        Open-Meteo + URLSession + async/await
  WeatherModels.swift         Codable 응답 모델
  UmbrellaDecision.swift      순수 함수: 시간별 확률 → 판정
  UmbrellaSnapshot.swift      공유 결과 + 표시 문구
  SharedStore.swift           App Group UserDefaults
  LocationProvider.swift      CoreLocation (위젯 인가 확인 포함)
  UmbrellaRefresher.swift     위치→조회→판정→캐시 오케스트레이션
  SnapshotFallback.swift      오프라인 폴백 (순수)
  TimelinePlanner.swift       위젯 엔트리 시각 계산 (순수)
  BackgroundRefreshPlanner.swift  BG 갱신 시각 계산 (순수)
  CalendarTime.swift          모호하지 않은 벽시계 연산

UmbrellaTests/              단위 테스트 (가짜 JSON 기반)
```

플랫폼 의존성이 없는 로직은 전부 `Shared/` 안에서 순수 함수·구조체로 분리돼
있어서, 시뮬레이터 없이도 테스트할 수 있습니다.

---

## 테스트

### Xcode

```
⌘U   (스킴: UmbrellaApp)
```

`UmbrellaTests` 는 **테스트 호스트가 없는 로직 전용 번들**입니다. 앱을 실행하지
않고 `Shared/` 소스를 직접 컴파일하므로 시뮬레이터 부팅이 빠릅니다.

### 커맨드라인 / CI

```bash
swift test          # macOS 또는 Linux, Xcode 불필요
```

`Package.swift` 는 `Shared/` 중 CoreLocation에 의존하지 않는 파일만
`UmbrellaCore` 라이브러리로 묶습니다. 테스트 파일은 두 방식 모두에서 그대로
쓰이도록 아래처럼 조건부 import 를 씁니다.

```swift
#if canImport(UmbrellaCore)
@testable import UmbrellaCore   // SwiftPM
#endif                          // Xcode에서는 소스를 직접 컴파일하므로 import 불필요
```

### 무엇을 검증하는가

모든 케이스는 **손으로 쓴 가짜 JSON 응답**(`ForecastFixtures`)으로 돌아갑니다.
네트워크에 나가지 않고, 기기 시간대나 "지금 시각"에도 의존하지 않습니다.

- **임계값 경계** — 54 / 55 / 56 %, 그리고 0~100 전 구간 스윕
- **빈 배열** — `hourly` 가 비었거나 키 자체가 없는 응답
- **null 값** — 전부 null, 일부 null (0으로 취급하지 않는지)
- **시간대 경계** — 기기는 UTC, 예보는 KST인 상황 / 음수 오프셋 / 날짜가 다른 행
- **평가 구간** — 06시·22시 경계 포함 여부, 구간 밖(03시·23시) 무시
- **깨진 입력** — 배열 길이 불일치, 파싱 불가 타임스탬프, 범위 밖 확률값
- **위젯 스케줄** — 2시간 간격, 22:00 이후 중단, 다음날 06:30, 월·연 경계
- **저장소** — 라운드트립, 임계값 0 과 "미설정" 구분, 스키마 버전 불일치 폐기
- **오프라인 폴백** — 조회 시각 보존, 임계값 변경 시 캐시 재판정

---

## 알려진 제한

- **알림은 그날 새벽 갱신이 성공해야 예약됩니다.** 반복 알림
  (`UNCalendarNotificationTrigger(repeats: true)`) 은 "비 올 때만" 이라는 조건을
  표현할 수 없기 때문에, 갱신에 성공한 시점에 그날치 1회성 알림을 겁니다.
  iOS가 백그라운드 실행을 건너뛴 날에는 알림이 오지 않을 수 있습니다.
  (비가 안 오는데 알림이 울리는 것보다 낫다고 판단했습니다.)
- **내일 예보는 조회하지 않습니다** (`forecast_days=1`). 따라서 알림도 오늘
  것만 예약합니다.
- **역지오코딩은 아껴 씁니다.** `CLGeocoder` 는 호출 제한이 있고 확장에서는
  권장되지 않으므로, 이전 위치에서 3km 이상 이동했을 때만 다시 조회하고
  그 외에는 App Group에 캐시된 지역명을 씁니다.
- **하루 중 서머타임이 바뀌는 지역**에서는 Open-Meteo가 돌려주는 단일
  `utc_offset_seconds` 로 하루를 판정하므로 경계 한 시간이 어긋날 수 있습니다.
- 앱 아이콘은 자리만 잡아 둔 빈 `AppIcon.appiconset` 입니다.

---

## 데이터 출처

Weather data by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0).
