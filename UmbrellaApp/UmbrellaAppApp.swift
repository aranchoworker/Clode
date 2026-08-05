import SwiftUI
import WidgetKit

@main
struct UmbrellaAppApp: App {

    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Must happen before the app finishes launching.
        BackgroundRefreshScheduler.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { url in
                    // Tapping the widget lands here. Force a full refresh so the
                    // user sees current data rather than whatever the widget's
                    // last timeline happened to hold.
                    guard url.scheme == AppConstants.urlScheme else { return }
                    Task { await model.refresh() }
                }
                .task {
                    model.refreshPermissionStates()
                    BackgroundRefreshScheduler.schedule()
                    await model.refreshIfStale()
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task {
                model.refreshPermissionStates()
                await model.refreshIfStale()
            }
        }
    }
}

/// Sends first-run users through onboarding, everyone else straight to the app.
struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if model.hasCompletedOnboarding {
            HomeView()
        } else {
            OnboardingView()
        }
    }
}
