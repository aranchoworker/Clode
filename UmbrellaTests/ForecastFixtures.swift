import Foundation
import XCTest

#if canImport(UmbrellaCore)
// SwiftPM builds the shared layer as a library; the Xcode test target instead
// compiles the same files directly, where no import is needed.
@testable import UmbrellaCore
#endif

/// Builders for hand-written Open-Meteo payloads.
///
/// The coordinates below exist only so the fixtures decode like a real response —
/// no production code path ever hardcodes a location.
enum ForecastFixtures {

    /// Renders a forecast JSON document with explicit hourly values.
    ///
    /// - Parameter hours: `(hour, probability)` pairs. A `nil` probability is
    ///   emitted as JSON `null`, exactly as Open-Meteo does for missing values.
    static func json(
        day: String = "2026-08-05",
        hours: [(hour: Int, probability: Int?)],
        timezone: String = "Asia/Seoul",
        utcOffsetSeconds: Int = 32_400,
        latitude: Double = 37.5665,
        longitude: Double = 126.9780
    ) -> String {
        let times = hours
            .map { String(format: "\"%@T%02d:00\"", day, $0.hour) }
            .joined(separator: ",")
        let probabilities = hours
            .map { $0.probability.map(String.init) ?? "null" }
            .joined(separator: ",")

        return """
        {
          "latitude": \(latitude),
          "longitude": \(longitude),
          "generationtime_ms": 0.0512,
          "utc_offset_seconds": \(utcOffsetSeconds),
          "timezone": "\(timezone)",
          "timezone_abbreviation": "KST",
          "elevation": 38.0,
          "hourly_units": { "time": "iso8601", "precipitation_probability": "%" },
          "hourly": {
            "time": [\(times)],
            "precipitation_probability": [\(probabilities)]
          }
        }
        """
    }

    /// A full 24-hour day where every hour carries `filler`, except the entries
    /// listed in `overrides`.
    static func fullDay(
        day: String = "2026-08-05",
        filler: Int? = 10,
        overrides: [Int: Int?] = [:],
        timezone: String = "Asia/Seoul",
        utcOffsetSeconds: Int = 32_400
    ) -> String {
        let hours: [(hour: Int, probability: Int?)] = (0...23).map { hour in
            if let override = overrides[hour] {
                return (hour, override)
            }
            return (hour, filler)
        }
        return json(
            day: day,
            hours: hours,
            timezone: timezone,
            utcOffsetSeconds: utcOffsetSeconds
        )
    }

    static func decode(_ json: String, file: StaticString = #filePath, line: UInt = #line) throws
        -> OpenMeteoForecast
    {
        let data = try XCTUnwrap(json.data(using: .utf8), file: file, line: line)
        return try WeatherService.decode(data)
    }
}

/// Deterministic date helpers — tests must never depend on the machine's
/// timezone or on "now".
enum TestDate {

    static func calendar(secondsFromGMT: Int) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: secondsFromGMT)!
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }

    /// Builds a `Date` from wall-clock components in a given UTC offset.
    static func make(
        _ year: Int,
        _ month: Int,
        _ day: Int,
        _ hour: Int = 0,
        _ minute: Int = 0,
        secondsFromGMT: Int = 0
    ) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        components.second = 0
        // swiftlint:disable:next force_unwrapping
        return calendar(secondsFromGMT: secondsFromGMT).date(from: components)!
    }
}
