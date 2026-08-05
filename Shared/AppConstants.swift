import Foundation

/// Single source of truth for every identifier that must stay in sync between
/// the app target, the widget extension and the Xcode project settings.
///
/// If you fork this project, change `teamPrefixedAppGroup` (or the raw values
/// below) **here only** — nothing else in the codebase hardcodes these strings.
/// The matching Xcode setup steps are described in README.md.
public enum AppConstants {

    // MARK: - Bundle identifiers

    /// Bundle identifier of the container (main) app target.
    public static let appBundleIdentifier = "com.example.umbrella"

    /// Bundle identifier of the widget extension target.
    /// Must be prefixed by `appBundleIdentifier`, otherwise iOS refuses to embed it.
    public static let widgetBundleIdentifier = "com.example.umbrella.widget"

    // MARK: - App Group

    /// App Group container shared by both targets.
    /// Must be enabled in *Signing & Capabilities* for the app **and** the widget.
    public static let appGroupIdentifier = "group.com.example.umbrella"

    // MARK: - WidgetKit

    /// `kind` string passed to `WidgetCenter.reloadTimelines(ofKind:)` and to the
    /// `Widget` declaration. They must match exactly.
    public static let widgetKind = "UmbrellaWidget"

    // MARK: - Background refresh

    /// Identifier registered in Info.plist under `BGTaskSchedulerPermittedIdentifiers`
    /// and used with `BGAppRefreshTaskRequest`.
    public static let backgroundRefreshTaskIdentifier = "com.example.umbrella.refresh"

    // MARK: - Deep link

    /// URL scheme used by the widget tap target so the app can force a refresh.
    public static let urlScheme = "umbrella"

    /// Full deep link opened when the user taps the widget.
    public static let widgetTapURL = URL(string: "\(urlScheme)://refresh")!

    // MARK: - Notifications

    /// Identifier of the repeating daily local notification request.
    public static let dailyNotificationIdentifier = "umbrella.daily.reminder"
}

/// Keys stored in the shared `UserDefaults` suite.
/// Kept next to `AppConstants` so the widget and the app can never drift apart.
public enum SharedDefaultsKey {
    public static let threshold = "settings.threshold"
    public static let notificationsEnabled = "settings.notificationsEnabled"
    public static let notificationHour = "settings.notificationHour"
    public static let notificationMinute = "settings.notificationMinute"

    public static let cachedSnapshot = "cache.snapshot"
    public static let lastKnownLatitude = "cache.lastKnownLatitude"
    public static let lastKnownLongitude = "cache.lastKnownLongitude"
    public static let lastKnownPlaceName = "cache.lastKnownPlaceName"
    /// Coordinate the cached place name was resolved for, so we can tell whether
    /// the user has moved far enough to justify another geocoder call.
    public static let placeNameLatitude = "cache.placeNameLatitude"
    public static let placeNameLongitude = "cache.placeNameLongitude"
    public static let didCompleteOnboarding = "app.didCompleteOnboarding"
}

/// Values used when the user has never opened the settings screen.
public enum AppDefaults {
    /// Precipitation probability (%) at or above which an umbrella is recommended.
    public static let threshold = 55

    /// Daily reminder fires at 07:00 local time by default.
    public static let notificationHour = 7
    public static let notificationMinute = 0

    public static let notificationsEnabled = true

    /// Hours of the day that are considered when deciding (inclusive).
    /// 06:00 … 22:00 as specified in the product requirements.
    public static let evaluationWindow: ClosedRange<Int> = 6...22
}
