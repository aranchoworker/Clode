import CoreLocation
import Foundation
import SwiftUI
import UserNotifications
import WidgetKit

/// Single observable owner of app state.
///
/// Everything it publishes is derived from the App Group store, so the app and
/// the widget can never disagree about the current verdict or settings.
@MainActor
final class AppModel: ObservableObject {

    @Published private(set) var snapshot: UmbrellaSnapshot?
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastErrorMessage: String?

    @Published private(set) var locationStatus: CLAuthorizationStatus
    @Published private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined

    /// Mirrors the persisted settings. Assigning writes through to the App Group
    /// and re-derives everything that depends on them.
    @Published var settings: AppSettings {
        didSet {
            guard settings != oldValue else { return }
            store.settings = settings
            applySettingsChange(previous: oldValue)
        }
    }

    @Published var hasCompletedOnboarding: Bool

    private let store: SharedStore
    private let locationProvider: LocationProvider

    init(
        store: SharedStore = .shared,
        locationProvider: LocationProvider = .shared
    ) {
        self.store = store
        self.locationProvider = locationProvider
        self.settings = store.settings
        self.snapshot = store.snapshot
        self.hasCompletedOnboarding = store.didCompleteOnboarding
        self.locationStatus = locationProvider.authorizationStatus
    }

    var isUsingAppGroup: Bool { store.isUsingAppGroup }

    var needsLocationPermission: Bool {
        switch locationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return false
        default: return true
        }
    }

    // MARK: - Permissions

    func requestLocationPermission() {
        locationProvider.requestWhenInUseAuthorization()
        // The system prompt is answered asynchronously; poll once shortly after
        // so the UI reflects the choice without needing a scene change.
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            self.refreshPermissionStates()
        }
    }

    func requestNotificationPermission() async {
        await NotificationScheduler.requestAuthorization()
        await refreshNotificationStatus()
    }

    func refreshPermissionStates() {
        locationStatus = locationProvider.authorizationStatus
        Task { await refreshNotificationStatus() }
    }

    private func refreshNotificationStatus() async {
        notificationStatus = await NotificationScheduler.authorizationStatus()
    }

    func completeOnboarding() {
        hasCompletedOnboarding = true
        store.didCompleteOnboarding = true
    }

    // MARK: - Refresh

    /// Fetches a fresh forecast, re-arms the reminder and reloads the widget.
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        refreshPermissionStates()

        let result = await UmbrellaRefresher.refresh(
            store: store,
            locationProvider: locationProvider
        )
        snapshot = result

        lastErrorMessage = Self.errorMessage(for: result, locationStatus: locationStatus)

        await NotificationScheduler.reschedule(snapshot: result, settings: settings)
        BackgroundRefreshScheduler.schedule()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Called when the app is opened from the widget, or returns to foreground.
    func refreshIfStale(now: Date = Date(), maxAge: TimeInterval = 30 * 60) async {
        guard let snapshot else {
            await refresh()
            return
        }
        if now.timeIntervalSince(snapshot.updatedAt) > maxAge || snapshot.origin != .live {
            await refresh()
        }
    }

    private static func errorMessage(
        for snapshot: UmbrellaSnapshot,
        locationStatus: CLAuthorizationStatus
    ) -> String? {
        switch snapshot.origin {
        case .live:
            return nil
        case .cachedFallback:
            return "최신 정보를 가져오지 못해 마지막으로 받은 결과를 보여주고 있어요."
        case .unavailable:
            switch locationStatus {
            case .authorizedWhenInUse, .authorizedAlways:
                return "날씨 정보를 가져오지 못했어요. 네트워크 상태를 확인해 주세요."
            case .notDetermined:
                return "위치 권한을 허용하면 현재 위치의 강수확률을 확인할 수 있어요."
            default:
                return "위치 권한이 꺼져 있어요. 설정 > 우산 알림에서 '앱을 사용하는 동안'을 허용해 주세요."
            }
        }
    }

    // MARK: - Settings side effects

    /// Re-derives the verdict from the cached probability so a threshold change
    /// is reflected instantly, without waiting for the network.
    private func applySettingsChange(previous: AppSettings) {
        if settings.threshold != previous.threshold, var current = snapshot {
            current.threshold = settings.threshold
            current.needsUmbrella = current.probability.map { $0 >= settings.threshold } ?? false
            snapshot = current
            store.snapshot = current
        }

        let currentSnapshot = snapshot
        Task {
            if let currentSnapshot {
                await NotificationScheduler.reschedule(
                    snapshot: currentSnapshot,
                    settings: self.settings
                )
            } else {
                NotificationScheduler.cancel()
            }
        }

        BackgroundRefreshScheduler.schedule()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
