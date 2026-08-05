import SwiftUI
import UIKit

/// Main screen: today's verdict, where it came from, and when it was fetched.
struct HomeView: View {

    @EnvironmentObject private var model: AppModel
    @State private var isShowingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    verdictCard

                    if let message = model.lastErrorMessage {
                        NoticeBanner(message: message, kind: .warning)
                    }

                    if model.needsLocationPermission {
                        NoticeBanner(
                            message: "위치 권한이 필요해요. 허용하면 현재 위치 기준으로 강수확률을 확인합니다.",
                            kind: .action(title: "권한 허용") {
                                model.requestLocationPermission()
                            }
                        )
                    }

                    if !model.isUsingAppGroup {
                        NoticeBanner(
                            message: "App Group(\(AppConstants.appGroupIdentifier))이 설정되지 않아 위젯과 설정이 공유되지 않습니다. README의 설정 방법을 확인하세요.",
                            kind: .warning
                        )
                    }

                    refreshButton

                    Text("위젯은 iOS의 갱신 제한 때문에 실시간이 아니며, 하루 몇 차례만 새로 고쳐집니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding()
            }
            .navigationTitle("우산 알림")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Label("설정", systemImage: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
                    .environmentObject(model)
            }
            .refreshable { await model.refresh() }
        }
    }

    // MARK: - Verdict card

    @ViewBuilder
    private var verdictCard: some View {
        let snapshot = model.snapshot

        VStack(spacing: 12) {
            Image(systemName: snapshot?.symbolName ?? "questionmark.circle")
                .font(.system(size: 52))
                .foregroundStyle(snapshot?.needsUmbrella == true ? .white : .primary)

            Text(snapshot?.probabilityText ?? "--")
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .foregroundStyle(snapshot?.needsUmbrella == true ? .white : .primary)

            Text(snapshot?.headline ?? "정보 없음")
                .font(.title3.weight(.semibold))
                .foregroundStyle(snapshot?.needsUmbrella == true ? .white : .primary)

            if let snapshot {
                VStack(spacing: 2) {
                    if let place = snapshot.placeName, !place.isEmpty {
                        Text(place)
                    }
                    Text(snapshot.updatedText())
                    if let peak = snapshot.peakHourText {
                        Text(peak)
                    }
                    Text("기준 \(snapshot.threshold)% · 오늘 \(AppDefaults.evaluationWindow.lowerBound)–\(AppDefaults.evaluationWindow.upperBound)시")
                }
                .font(.footnote)
                .foregroundStyle(
                    snapshot.needsUmbrella ? Color.white.opacity(0.85) : Color.secondary
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var cardBackground: some View {
        if model.snapshot?.needsUmbrella == true {
            LinearGradient(
                colors: [
                    Color(red: 0.16, green: 0.36, blue: 0.72),
                    Color(red: 0.09, green: 0.22, blue: 0.50),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else {
            Color(uiColor: .secondarySystemBackground)
        }
    }

    private var refreshButton: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            HStack {
                if model.isRefreshing {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.clockwise")
                }
                Text(model.isRefreshing ? "새로고침 중…" : "지금 새로고침")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(model.isRefreshing)
    }
}

/// Small inline message with an optional action button.
struct NoticeBanner: View {

    enum Kind {
        case warning
        case action(title: String, handler: () -> Void)
    }

    let message: String
    let kind: Kind

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)

            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)

                if case .action(let title, let handler) = kind {
                    Button(title, action: handler)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
            Spacer(minLength: 0)
        }
        .padding()
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

#Preview {
    HomeView().environmentObject(AppModel())
}
