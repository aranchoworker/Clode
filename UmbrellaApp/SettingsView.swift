import SwiftUI
import UserNotifications

/// Threshold, reminder time and reminder on/off.
///
/// Every value written here goes straight into the App Group suite, which is
/// what the widget reads on its next timeline build.
struct SettingsView: View {

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                thresholdSection
                notificationSection
                infoSection
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("완료") { dismiss() }
                }
            }
        }
    }

    // MARK: - Threshold

    private var thresholdSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("임계값")
                    Spacer()
                    Text("\(model.settings.threshold)%")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                Slider(
                    value: Binding(
                        get: { Double(model.settings.threshold) },
                        set: { model.settings.threshold = Int($0.rounded()) }
                    ),
                    in: 0...100,
                    step: 1
                ) {
                    Text("임계값")
                } minimumValueLabel: {
                    Text("0%").font(.caption2)
                } maximumValueLabel: {
                    Text("100%").font(.caption2)
                }
                .accessibilityValue("\(model.settings.threshold) 퍼센트")
            }
        } header: {
            Text("우산 판정")
        } footer: {
            Text("오늘 \(AppDefaults.evaluationWindow.lowerBound)시부터 \(AppDefaults.evaluationWindow.upperBound)시 사이의 최고 강수확률이 이 값 이상이면 '우산 챙기세요'로 표시합니다.")
        }
    }

    // MARK: - Notifications

    private var notificationSection: some View {
        Section {
            Toggle("아침 알림", isOn: Binding(
                get: { model.settings.notificationsEnabled },
                set: { model.settings.notificationsEnabled = $0 }
            ))

            if model.settings.notificationsEnabled {
                DatePicker(
                    "알림 시간",
                    selection: notificationTimeBinding,
                    displayedComponents: .hourAndMinute
                )
            }

            if model.settings.notificationsEnabled,
               model.notificationStatus != .authorized {
                Button("알림 권한 요청") {
                    Task { await model.requestNotificationPermission() }
                }
            }
        } header: {
            Text("알림")
        } footer: {
            Text("강수확률이 임계값 이상인 날에만 알림을 보냅니다. 알림은 그날 새벽 백그라운드 갱신이 성공했을 때 예약되므로, iOS가 백그라운드 실행을 건너뛴 날에는 오지 않을 수 있습니다.")
        }
    }

    /// Bridges the stored hour/minute pair to the `DatePicker`'s `Date`.
    private var notificationTimeBinding: Binding<Date> {
        Binding(
            get: {
                var components = DateComponents()
                components.hour = model.settings.notificationHour
                components.minute = model.settings.notificationMinute
                return Calendar.current.date(from: components) ?? Date()
            },
            set: { newDate in
                let components = Calendar.current.dateComponents(
                    [.hour, .minute],
                    from: newDate
                )
                model.settings.notificationHour = components.hour ?? AppDefaults.notificationHour
                model.settings.notificationMinute = components.minute ?? AppDefaults.notificationMinute
            }
        )
    }

    // MARK: - Info

    private var infoSection: some View {
        Section {
            LabeledContent("App Group", value: model.isUsingAppGroup ? "연결됨" : "미설정")
            LabeledContent("데이터 출처", value: "Open-Meteo")
            if let snapshot = model.snapshot {
                LabeledContent("마지막 갱신", value: snapshot.updatedText())
            }
        } header: {
            Text("정보")
        } footer: {
            Text("위젯은 iOS가 허용하는 범위에서만 갱신되므로 실시간이 아닙니다. 표시된 '마지막 갱신' 시각을 기준으로 확인하세요.")
        }
    }
}

#Preview {
    SettingsView().environmentObject(AppModel())
}
