# voicealarm-alarm (로컬 네이티브 모듈)

Android 전용. `AlarmManager.setAlarmClock()` + 풀스크린 인텐트 + Foreground Service +
`STREAM_ALARM` 재생 + 재부팅 복구를 구현한다. `voicealarm/app/src/alarms/androidAlarm.ts` 가
이 모듈을 부른다.

## ⚠️ 실기기/컴파일 검증이 안 된 상태입니다

이 모듈은 Android Studio/에뮬레이터가 없는 환경에서 작성됐습니다. **문법 오류나 API
오용이 있을 가능성을 배제할 수 없습니다.** 처음 빌드할 때 다음을 반드시 해 주세요:

```bash
cd voicealarm/app
npx expo prebuild --platform android   # 네이티브 프로젝트 생성, 이 모듈이 자동 링크되는지 확인
npx expo run:android                   # 실제 빌드 + 실행
```

`prebuild` 직후 `android/settings.gradle` 를 열어 `voicealarm-alarm` 이 포함돼 있는지
확인하세요. 안 보이면 자동 링크가 이 디렉터리(`app/modules/`)를 못 찾은 것입니다 —
`expo-modules-autolinking` 은 기본으로 `<프로젝트 루트>/modules` 를 스캔하도록 되어 있지만
버전에 따라 달라질 수 있습니다.

빌드가 실패하면 Gradle 에러 메시지를 보고 해당 `.kt` 파일을 고쳐야 합니다. 자주 날 법한
지점을 미리 적어 둡니다.

## 자주 틀렸을 만한 지점 (빌드 에러 나면 여기부터 의심)

- **`androidx.security:security-crypto:1.1.0-alpha06`** — 이 좌표는 오랫동안 alpha 상태다.
  빌드 시점에 더 최신 버전이 있으면 `android/build.gradle` 에서 올려도 된다. `MasterKey`
  API 자체가 alpha03 이상에서 나온 것이라, 혹시 더 오래된 버전으로 자동 치환되면
  `MasterKeys.getOrCreate(...)` 구식 API 로 바꿔야 한다.
- **`Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`** — API 31(S) 이상에만 존재하는 상수.
  `VoicealarmAlarmModule.kt` 에서 버전 가드를 해 뒀지만, `minSdkVersion` 이 31 미만이면
  컴파일 자체는 되고 런타임에서만 분기한다.
- **`android:foregroundServiceType="mediaPlayback"`** — Android 14(API 34)+ 에서
  `startForeground()` 호출 시 매니페스트의 타입과 실제 `startForeground()` 호출이 일치해야
  한다. `AlarmForegroundService.kt` 는 별도 타입 인자를 안 넘기는 오버로드를 쓰는데, 이게
  타깃 SDK 34+ 에서 타입 불일치로 거부될 수 있다 — 이 경우
  `startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)`
  형태로 바꿔야 한다.
- **`R` 클래스 참조**(`R.layout.activity_alarm`, `R.id.senderNameText` 등) — 모듈
  네임스페이스(`expo.modules.voicealarmalarm`)로 로컬 `R` 클래스가 생성된다는 전제다.
  AGP 버전에 따라 `import expo.modules.voicealarmalarm.R` 을 명시해야 할 수도 있다(보통은
  같은 패키지라 자동으로 보인다).
- **`PendingIntent` requestCode 충돌** — `alarmId.hashCode()` 를 그대로 쓴다. 다른 알람과
  해시가 겹칠 확률은 낮지만 0은 아니다. 실사용 규모가 커지면 알람마다 별도 정수 ID를
  발급해서 매핑을 관리하는 편이 안전하다.

## 확인해야 할 동작 체크리스트 (완료 기준과 대응)

- [ ] 화면 잠금 + 무음 모드에서 예약 시각에 알람 화면이 뜨는가
- [ ] "다시 알림" 누르면 5분 뒤 다시 울리는가 (네트워크 없이도 동작해야 함 — 로컬에
      저장된 파일을 재사용하므로)
- [ ] "해제" 누르면 소리가 멈추고 서버에 ack 가 가는가 (서버 로그 또는
      `GET /alarms?role=received` 로 상태가 `delivered` 로 바뀌는지 확인)
- [ ] 기기를 재부팅한 뒤에도 예약된 알람이 남아 있는가 (BootReceiver)
- [ ] 예약 후 발신자가 차단당하면, 발화 직전 재검증에서 걸려 울리지 않는가
      (`AlarmForegroundService.verifyAndRing` 가 GET /alarms/:id/validity 호출)
- [ ] 비행기 모드(오프라인)에서도 예약된 알람이 울리는가 (재검증 실패 시 "그냥 울림"
      정책이 의도대로 동작하는지)
- [ ] "정확한 알람" 권한을 끈 상태에서 `openExactAlarmSettings()` 이 올바른 설정 화면으로
      이동하는가

## 왜 이런 구조인가

- **BroadcastReceiver 는 startForegroundService() 만 하고 끝낸다** — onReceive() 실행 시간
  제한(약 10초) 때문에 네트워크·오디오 재생을 여기서 하면 안 된다.
- **발화 직전 재검증은 네이티브 코드가 직접 한다** — 앱이 완전히 종료된 상태로 알람이
  울리면 JS/React Native 엔진이 아예 안 뜬다. JS 를 깨우는 방법에 의존하면 이 앱의
  핵심 안전장치(차단하면 안 울림)가 "앱이 켜져 있을 때만" 동작하는 게 되어 버린다.
- **재검증 실패(오프라인 등)는 "그냥 울림"으로 처리한다** — 서버가 명시적으로
  `valid:false` 라고 답했을 때만 막는다. 완료 기준에 "비행기 모드에서도 알람이 운다"가
  있기 때문에, 확인 자체가 안 되는 상황과 확인 결과 무효인 상황을 구분해야 한다.
