import Foundation

/// Where the data being displayed came from.
public enum SnapshotOrigin: String, Codable, Sendable {
    /// Freshly fetched from the network.
    case live
    /// Network failed; showing the previously cached result.
    case cachedFallback
    /// Network failed and there was nothing cached.
    case unavailable
}

/// The unit of state shared between the app and the widget.
///
/// Persisted as JSON in the App Group so the widget can render instantly without
/// waiting on the network, and so a failed fetch can fall back to the last good
/// answer. Carries its own display strings to keep the widget and the app
/// phrasing identical.
public struct UmbrellaSnapshot: Codable, Equatable, Sendable {

    /// Bumped whenever the stored shape changes incompatibly. A cached blob with
    /// an unexpected version is discarded rather than migrated.
    public static let currentSchemaVersion = 1

    public var schemaVersion: Int
    public var needsUmbrella: Bool
    public var probability: Int?
    public var peakHour: Int?
    public var threshold: Int
    public var placeName: String?
    public var latitude: Double
    public var longitude: Double

    /// When the underlying forecast was fetched (not when it was rendered).
    public var updatedAt: Date
    public var origin: SnapshotOrigin

    public init(
        schemaVersion: Int = UmbrellaSnapshot.currentSchemaVersion,
        needsUmbrella: Bool,
        probability: Int?,
        peakHour: Int?,
        threshold: Int,
        placeName: String?,
        latitude: Double,
        longitude: Double,
        updatedAt: Date,
        origin: SnapshotOrigin
    ) {
        self.schemaVersion = schemaVersion
        self.needsUmbrella = needsUmbrella
        self.probability = probability
        self.peakHour = peakHour
        self.threshold = threshold
        self.placeName = placeName
        self.latitude = latitude
        self.longitude = longitude
        self.updatedAt = updatedAt
        self.origin = origin
    }

    /// Builds a snapshot from a verdict produced by `UmbrellaDecision`.
    public init(
        verdict: UmbrellaVerdict,
        placeName: String?,
        latitude: Double,
        longitude: Double,
        updatedAt: Date,
        origin: SnapshotOrigin
    ) {
        self.init(
            needsUmbrella: verdict.needsUmbrella,
            probability: verdict.maxProbability,
            peakHour: verdict.peakHour,
            threshold: verdict.threshold,
            placeName: placeName,
            latitude: latitude,
            longitude: longitude,
            updatedAt: updatedAt,
            origin: origin
        )
    }

    public var hasData: Bool { probability != nil }

    // MARK: - Display

    /// `"우산 챙기세요"` / `"우산 필요 없어요"` / `"정보 없음"`.
    public var headline: String {
        guard hasData else { return "정보 없음" }
        return needsUmbrella ? "우산 챙기세요" : "우산 필요 없어요"
    }

    /// `"78%"`, or `"--"` when there is no data.
    public var probabilityText: String {
        guard let probability else { return "--" }
        return "\(probability)%"
    }

    /// `"우산 챙기세요 · 78%"` — the one-line form used across every widget family.
    public var summaryLine: String {
        "\(headline) · \(probabilityText)"
    }

    /// SF Symbol matching the verdict.
    public var symbolName: String {
        guard hasData else { return "questionmark.circle" }
        return needsUmbrella ? "umbrella.fill" : "sun.max.fill"
    }

    /// `"마지막 갱신 07:12"`. Formatted in the viewer's current locale/timezone.
    public func updatedText(locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        "마지막 갱신 \(Self.timeString(from: updatedAt, locale: locale, timeZone: timeZone))"
    }

    /// `"오후 3시경 가장 높아요"` — only meaningful when a peak hour is known.
    public var peakHourText: String? {
        guard let peakHour else { return nil }
        return "\(peakHour)시경 최고"
    }

    /// Title of the morning reminder.
    public var notificationTitle: String { "☂️ 우산 챙기세요" }

    /// Body of the morning reminder, e.g.
    /// `"중구는 오늘 최고 강수확률 78%예요. (기준 55%)"`.
    public var notificationBody: String {
        let probability = probabilityText
        let place = placeName.flatMap { $0.isEmpty ? nil : $0 }
        let prefix = place.map { "\($0)는 오늘" } ?? "오늘"
        return "\(prefix) 최고 강수확률 \(probability)예요. (기준 \(threshold)%)"
    }

    /// The forecast is only fetched a handful of times a day; anything older than
    /// this is worth flagging in the UI.
    public static let stalenessThreshold: TimeInterval = 6 * 60 * 60

    public func isStale(asOf now: Date) -> Bool {
        now.timeIntervalSince(updatedAt) > Self.stalenessThreshold
    }

    static func timeString(from date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    // MARK: - Placeholders

    /// Used for the WidgetKit gallery/placeholder rendering, where no real data
    /// is available and hardcoded sample values are the expected behaviour.
    public static func placeholder(now: Date = Date()) -> UmbrellaSnapshot {
        UmbrellaSnapshot(
            needsUmbrella: true,
            probability: 78,
            peakHour: 15,
            threshold: AppDefaults.threshold,
            placeName: "현재 위치",
            latitude: 0,
            longitude: 0,
            updatedAt: now,
            origin: .live
        )
    }

    /// Shown when the network failed and nothing was ever cached.
    public static func unavailable(
        threshold: Int,
        placeName: String?,
        latitude: Double,
        longitude: Double,
        now: Date
    ) -> UmbrellaSnapshot {
        UmbrellaSnapshot(
            needsUmbrella: false,
            probability: nil,
            peakHour: nil,
            threshold: threshold,
            placeName: placeName,
            latitude: latitude,
            longitude: longitude,
            updatedAt: now,
            origin: .unavailable
        )
    }
}
