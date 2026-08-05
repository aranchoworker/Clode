import SwiftUI
import UserNotifications

/// First-run permission walkthrough.
///
/// Asks for location ("while using the app" only) and notifications, explaining
/// why each is needed before the system prompt appears. Both are skippable —
/// the app degrades to the last known coordinate and to widget-only use.
struct OnboardingView: View {

    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header

                    PermissionRow(
                        symbol: "location.fill",
                        title: "위치",
                        detail: "현재 위치의 오늘 강수확률을 조회합니다. '앱을 사용하는 동안'만 허용하면 되고, '항상 허용'은 필요하지 않습니다.",
                        isGranted: !model.needsLocationPermission,
                        actionTitle: "위치 권한 허용"
                    ) {
                        model.requestLocationPermission()
                    }

                    PermissionRow(
                        symbol: "bell.badge.fill",
                        title: "알림",
                        detail: "비 올 확률이 높은 날 아침에만 알려드립니다. 확률이 낮은 날에는 알림을 보내지 않습니다.",
                        isGranted: model.notificationStatus == .authorized,
                        actionTitle: "알림 권한 허용"
                    ) {
                        Task { await model.requestNotificationPermission() }
                    }

                    Text("위젯은 iOS의 갱신 제한 때문에 실시간이 아닙니다. 위젯에 표시되는 '마지막 갱신' 시각으로 언제 받은 정보인지 확인할 수 있어요.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }

            Button {
                model.completeOnboarding()
                Task { await model.refresh() }
            } label: {
                Text("시작하기")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding()
        }
        .onAppear { model.refreshPermissionStates() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "umbrella.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("우산 알림")
                .font(.largeTitle.bold())
            Text("오늘 비 올 확률을 확인하고, 우산이 필요한 날에만 알려드립니다.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 24)
    }
}

private struct PermissionRow: View {
    let symbol: String
    let title: String
    let detail: String
    let isGranted: Bool
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title2)
                .frame(width: 32)
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(title).font(.headline)
                    if isGranted {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .accessibilityLabel("허용됨")
                    }
                }

                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if !isGranted {
                    Button(actionTitle, action: action)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
    }
}

#Preview {
    OnboardingView().environmentObject(AppModel())
}
