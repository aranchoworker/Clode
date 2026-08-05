import Foundation

/// Outcome of evaluating a day's hourly precipitation probabilities.
public struct UmbrellaVerdict: Equatable, Sendable {

    /// `true` when the peak probability inside the evaluation window reached the
    /// threshold. Always `false` when there was no usable data.
    public let needsUmbrella: Bool

    /// Highest probability (%) found inside the window, or `nil` when no hour in
    /// the window carried a value.
    public let maxProbability: Int?

    /// Local hour (0…23) the peak was observed at, or `nil` when there is no data.
    public let peakHour: Int?

    /// How many hours inside the window contributed a non-null probability.
    public let sampleCount: Int

    /// Threshold the verdict was produced with, echoed back so callers can
    /// render "78% ≥ 55%" without having to thread the setting through again.
    public let threshold: Int

    public var hasData: Bool { maxProbability != nil }

    public init(
        needsUmbrella: Bool,
        maxProbability: Int?,
        peakHour: Int?,
        sampleCount: Int,
        threshold: Int
    ) {
        self.needsUmbrella = needsUmbrella
        self.maxProbability = maxProbability
        self.peakHour = peakHour
        self.sampleCount = sampleCount
        self.threshold = threshold
    }

    /// Verdict used when the network failed and no cache exists.
    public static func noData(threshold: Int) -> UmbrellaVerdict {
        UmbrellaVerdict(
            needsUmbrella: false,
            maxProbability: nil,
            peakHour: nil,
            sampleCount: 0,
            threshold: threshold
        )
    }
}

/// Pure decision logic: hourly probabilities in, verdict out.
///
/// Deliberately free of networking, `URLSession`, CoreLocation and WidgetKit so
/// that it can be exercised from unit tests with hand-written JSON on any
/// platform. Nothing here reads the clock except through the `now` parameter the
/// caller supplies.
public enum UmbrellaDecision {

    // MARK: - Timestamp parsing

    /// The two pieces of an Open-Meteo timestamp that the decision cares about.
    struct Stamp: Equatable {
        /// `"2026-08-05"`
        let day: String
        /// `0…23`
        let hour: Int
    }

    /// Parses `"2026-08-05T06:00"` (or `"…T06:00:00"`) without going through
    /// `DateFormatter`, so the result cannot shift with device locale/calendar.
    /// Returns `nil` for anything that does not match the expected shape.
    static func parse(_ timestamp: String) -> Stamp? {
        guard let separator = timestamp.firstIndex(of: "T") else { return nil }

        let day = String(timestamp[timestamp.startIndex..<separator])
        // Expect exactly `yyyy-MM-dd`.
        guard day.count == 10 else { return nil }
        let dayCharacters = Array(day)
        guard dayCharacters[4] == "-", dayCharacters[7] == "-" else { return nil }
        guard Int(day.prefix(4)) != nil,
              Int(day.dropFirst(5).prefix(2)) != nil,
              Int(day.dropFirst(8).prefix(2)) != nil
        else { return nil }

        let timePart = timestamp[timestamp.index(after: separator)...]
        let hourPart = timePart.prefix { $0 != ":" }
        guard hourPart.count == 2,
              let hour = Int(hourPart),
              (0...23).contains(hour)
        else { return nil }

        return Stamp(day: day, hour: hour)
    }

    // MARK: - Local day

    /// Formats `date` as `yyyy-MM-dd` in the forecast's own UTC offset.
    ///
    /// This is what makes the "which day is today?" question unambiguous when
    /// the device timezone and the forecast location's timezone disagree — the
    /// forecast's offset always wins, because that is the offset its `hourly.time`
    /// strings are expressed in.
    public static func localDay(for date: Date, utcOffsetSeconds: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: utcOffsetSeconds)
            ?? TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }

    // MARK: - Evaluation

    /// Core rule: the maximum precipitation probability across the evaluation
    /// window of a single local day decides whether an umbrella is needed.
    ///
    /// - Parameters:
    ///   - hourlyTimes: naive local timestamps from `hourly.time`.
    ///   - probabilities: matching `hourly.precipitation_probability` values; `nil`
    ///     entries are skipped rather than treated as `0`.
    ///   - threshold: percentage at or above which an umbrella is recommended.
    ///     Clamped into `0...100`.
    ///   - window: inclusive local-hour range to consider.
    ///   - localDay: the `yyyy-MM-dd` day to evaluate, expressed in the forecast's
    ///     own timezone. Rows on any other day are ignored.
    ///
    /// Arrays of differing lengths are tolerated — only the common prefix is read.
    public static func evaluate(
        hourlyTimes: [String],
        probabilities: [Int?],
        threshold: Int,
        window: ClosedRange<Int> = AppDefaults.evaluationWindow,
        localDay: String
    ) -> UmbrellaVerdict {

        let effectiveThreshold = min(max(threshold, 0), 100)

        var maxProbability: Int?
        var peakHour: Int?
        var sampleCount = 0

        let count = min(hourlyTimes.count, probabilities.count)
        for index in 0..<count {
            guard let stamp = parse(hourlyTimes[index]) else { continue }
            guard stamp.day == localDay else { continue }
            guard window.contains(stamp.hour) else { continue }
            guard let rawValue = probabilities[index] else { continue }

            sampleCount += 1
            let value = min(max(rawValue, 0), 100)

            // Strictly-greater keeps the *earliest* hour when several hours tie,
            // which is the more useful one to show the user.
            if maxProbability == nil || value > maxProbability! {
                maxProbability = value
                peakHour = stamp.hour
            }
        }

        return UmbrellaVerdict(
            needsUmbrella: maxProbability.map { $0 >= effectiveThreshold } ?? false,
            maxProbability: maxProbability,
            peakHour: peakHour,
            sampleCount: sampleCount,
            threshold: effectiveThreshold
        )
    }

    /// Convenience overload that derives the local day from the forecast itself.
    public static func evaluate(
        forecast: OpenMeteoForecast,
        threshold: Int,
        window: ClosedRange<Int> = AppDefaults.evaluationWindow,
        now: Date
    ) -> UmbrellaVerdict {
        evaluate(
            hourlyTimes: forecast.hourly.time,
            probabilities: forecast.hourly.precipitationProbability,
            threshold: threshold,
            window: window,
            localDay: localDay(for: now, utcOffsetSeconds: forecast.utcOffsetSeconds)
        )
    }
}
