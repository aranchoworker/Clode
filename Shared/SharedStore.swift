import Foundation

/// User-tunable settings, read by both targets.
///
/// Every numeric field clamps on write, so an out-of-range value can never reach
/// storage — whether it came from a slider, a decoded blob, or a future caller.
public struct AppSettings: Equatable, Sendable {

    private var storedThreshold: Int
    private var storedHour: Int
    private var storedMinute: Int

    /// Precipitation probability (%) at or above which an umbrella is
    /// recommended. Clamped to `0...100`.
    public var threshold: Int {
        get { storedThreshold }
        set { storedThreshold = min(max(newValue, 0), 100) }
    }

    public var notificationsEnabled: Bool

    /// Clamped to `0...23`.
    public var notificationHour: Int {
        get { storedHour }
        set { storedHour = min(max(newValue, 0), 23) }
    }

    /// Clamped to `0...59`.
    public var notificationMinute: Int {
        get { storedMinute }
        set { storedMinute = min(max(newValue, 0), 59) }
    }

    public init(
        threshold: Int = AppDefaults.threshold,
        notificationsEnabled: Bool = AppDefaults.notificationsEnabled,
        notificationHour: Int = AppDefaults.notificationHour,
        notificationMinute: Int = AppDefaults.notificationMinute
    ) {
        self.storedThreshold = min(max(threshold, 0), 100)
        self.notificationsEnabled = notificationsEnabled
        self.storedHour = min(max(notificationHour, 0), 23)
        self.storedMinute = min(max(notificationMinute, 0), 59)
    }
}

/// A geographic coordinate, kept free of CoreLocation so the shared layer stays
/// testable on any platform.
public struct Coordinate: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    /// Rough great-circle distance in metres. Used only to decide whether the
    /// cached place name is still close enough to reuse, so the cheap
    /// equirectangular approximation is plenty.
    public func distance(to other: Coordinate) -> Double {
        let earthRadius = 6_371_000.0
        let lat1 = latitude * .pi / 180
        let lat2 = other.latitude * .pi / 180
        let deltaLat = (other.latitude - latitude) * .pi / 180
        let deltaLon = (other.longitude - longitude) * .pi / 180
        let x = deltaLon * cos((lat1 + lat2) / 2)
        return earthRadius * (x * x + deltaLat * deltaLat).squareRoot()
    }
}

/// Everything persisted in the App Group container.
///
/// Both the app and the widget extension talk to the same `UserDefaults` suite,
/// which is what lets a setting changed in the app take effect in the widget.
/// The initialiser accepts an explicit `UserDefaults` so tests can run against a
/// throwaway suite instead of the real group.
public final class SharedStore: @unchecked Sendable {

    /// Shared instance backed by the real App Group suite.
    public static let shared = SharedStore()

    private let defaults: UserDefaults

    /// - Parameter defaults: pass `nil` to use the App Group suite.
    ///   Falls back to `.standard` if the suite cannot be opened, which happens
    ///   when the App Group capability has not been configured in Xcode yet —
    ///   the app still runs, but the widget will not see the app's settings.
    public init(defaults: UserDefaults? = nil) {
        if let defaults {
            self.defaults = defaults
        } else if let suite = UserDefaults(suiteName: AppConstants.appGroupIdentifier) {
            self.defaults = suite
        } else {
            assertionFailure(
                "App Group '\(AppConstants.appGroupIdentifier)' is unavailable. "
                + "Enable the App Groups capability on both targets — see README.md."
            )
            self.defaults = .standard
        }
    }

    /// `true` when the App Group suite really opened. Surfaced in the app's
    /// settings screen so a misconfigured project is obvious during development.
    public var isUsingAppGroup: Bool {
        defaults !== UserDefaults.standard
    }

    // MARK: - Settings

    public var settings: AppSettings {
        get {
            AppSettings(
                threshold: integer(SharedDefaultsKey.threshold) ?? AppDefaults.threshold,
                notificationsEnabled: bool(SharedDefaultsKey.notificationsEnabled)
                    ?? AppDefaults.notificationsEnabled,
                notificationHour: integer(SharedDefaultsKey.notificationHour)
                    ?? AppDefaults.notificationHour,
                notificationMinute: integer(SharedDefaultsKey.notificationMinute)
                    ?? AppDefaults.notificationMinute
            )
        }
        set {
            // Re-run the initialiser's clamping so out-of-range values can never
            // reach storage, whatever the caller passed in.
            let sanitised = AppSettings(
                threshold: newValue.threshold,
                notificationsEnabled: newValue.notificationsEnabled,
                notificationHour: newValue.notificationHour,
                notificationMinute: newValue.notificationMinute
            )
            defaults.set(sanitised.threshold, forKey: SharedDefaultsKey.threshold)
            defaults.set(sanitised.notificationsEnabled, forKey: SharedDefaultsKey.notificationsEnabled)
            defaults.set(sanitised.notificationHour, forKey: SharedDefaultsKey.notificationHour)
            defaults.set(sanitised.notificationMinute, forKey: SharedDefaultsKey.notificationMinute)
        }
    }

    public var threshold: Int { settings.threshold }

    // MARK: - Cached result

    public var snapshot: UmbrellaSnapshot? {
        get {
            guard let data = defaults.data(forKey: SharedDefaultsKey.cachedSnapshot) else {
                return nil
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            // A blob written by an older build is treated as "no cache" rather
            // than crashing the widget.
            guard let decoded = try? decoder.decode(UmbrellaSnapshot.self, from: data),
                  decoded.schemaVersion == UmbrellaSnapshot.currentSchemaVersion
            else { return nil }
            return decoded
        }
        set {
            guard let newValue else {
                defaults.removeObject(forKey: SharedDefaultsKey.cachedSnapshot)
                return
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard let data = try? encoder.encode(newValue) else { return }
            defaults.set(data, forKey: SharedDefaultsKey.cachedSnapshot)
        }
    }

    // MARK: - Last known location

    /// Fallback coordinate used when CoreLocation cannot produce a fix — most
    /// commonly inside the widget extension, which gets far less location
    /// airtime than the foreground app.
    public var lastKnownCoordinate: Coordinate? {
        get {
            guard let latitude = double(SharedDefaultsKey.lastKnownLatitude),
                  let longitude = double(SharedDefaultsKey.lastKnownLongitude)
            else { return nil }
            return Coordinate(latitude: latitude, longitude: longitude)
        }
        set {
            guard let newValue else {
                defaults.removeObject(forKey: SharedDefaultsKey.lastKnownLatitude)
                defaults.removeObject(forKey: SharedDefaultsKey.lastKnownLongitude)
                return
            }
            defaults.set(newValue.latitude, forKey: SharedDefaultsKey.lastKnownLatitude)
            defaults.set(newValue.longitude, forKey: SharedDefaultsKey.lastKnownLongitude)
        }
    }

    /// Reverse-geocoded name of `lastKnownCoordinate`, cached because `CLGeocoder`
    /// is rate limited and a widget must not hammer it on every timeline build.
    public var lastKnownPlaceName: String? {
        get { defaults.string(forKey: SharedDefaultsKey.lastKnownPlaceName) }
        set {
            guard let newValue else {
                defaults.removeObject(forKey: SharedDefaultsKey.lastKnownPlaceName)
                return
            }
            defaults.set(newValue, forKey: SharedDefaultsKey.lastKnownPlaceName)
        }
    }

    /// Coordinate `lastKnownPlaceName` was resolved for.
    public var placeNameCoordinate: Coordinate? {
        get {
            guard let latitude = double(SharedDefaultsKey.placeNameLatitude),
                  let longitude = double(SharedDefaultsKey.placeNameLongitude)
            else { return nil }
            return Coordinate(latitude: latitude, longitude: longitude)
        }
        set {
            guard let newValue else {
                defaults.removeObject(forKey: SharedDefaultsKey.placeNameLatitude)
                defaults.removeObject(forKey: SharedDefaultsKey.placeNameLongitude)
                return
            }
            defaults.set(newValue.latitude, forKey: SharedDefaultsKey.placeNameLatitude)
            defaults.set(newValue.longitude, forKey: SharedDefaultsKey.placeNameLongitude)
        }
    }

    // MARK: - Onboarding

    public var didCompleteOnboarding: Bool {
        get { defaults.bool(forKey: SharedDefaultsKey.didCompleteOnboarding) }
        set { defaults.set(newValue, forKey: SharedDefaultsKey.didCompleteOnboarding) }
    }

    // MARK: - Typed accessors
    //
    // `UserDefaults.integer(forKey:)` cannot distinguish "absent" from "0", which
    // matters here: a stored threshold of 0 is a legitimate user choice.

    private func integer(_ key: String) -> Int? {
        guard let value = defaults.object(forKey: key) else { return nil }
        if let number = value as? NSNumber { return number.intValue }
        if let int = value as? Int { return int }
        if let double = value as? Double { return Int(double) }
        return nil
    }

    private func double(_ key: String) -> Double? {
        guard let value = defaults.object(forKey: key) else { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        return nil
    }

    private func bool(_ key: String) -> Bool? {
        guard let value = defaults.object(forKey: key) else { return nil }
        if let number = value as? NSNumber { return number.boolValue }
        if let bool = value as? Bool { return bool }
        if let int = value as? Int { return int != 0 }
        return nil
    }
}
