import Foundation
import XCTest

#if canImport(UmbrellaCore)
@testable import UmbrellaCore
#endif

/// Tests for the pure decision rule, driven entirely by fake JSON responses.
final class UmbrellaDecisionTests: XCTestCase {

    /// 2026-08-05, 09:00 in Seoul — the reference "now" for most cases.
    private let seoulOffset = 32_400
    private var seoulNow: Date {
        TestDate.make(2026, 8, 5, 9, 0, secondsFromGMT: seoulOffset)
    }

    // MARK: - Threshold boundary (54 / 55 / 56 against a threshold of 55)

    func testPeakOnePercentBelowThresholdDoesNotNeedUmbrella() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 10, overrides: [14: 54])
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 54)
        XCTAssertEqual(verdict.peakHour, 14)
    }

    /// The rule is "threshold 이상" — 55 against a threshold of 55 must trigger.
    func testPeakExactlyAtThresholdNeedsUmbrella() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 10, overrides: [14: 55])
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertTrue(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 55)
    }

    func testPeakOnePercentAboveThresholdNeedsUmbrella() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 10, overrides: [14: 56])
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertTrue(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 56)
    }

    /// The same three payloads, swept across every threshold, to pin the
    /// comparison operator down rather than trusting three spot checks.
    func testBoundarySweep() throws {
        for peak in [54, 55, 56] {
            let forecast = try ForecastFixtures.decode(
                ForecastFixtures.fullDay(filler: 0, overrides: [14: peak])
            )
            for threshold in 0...100 {
                let verdict = UmbrellaDecision.evaluate(
                    forecast: forecast,
                    threshold: threshold,
                    now: seoulNow
                )
                XCTAssertEqual(
                    verdict.needsUmbrella,
                    peak >= threshold,
                    "peak \(peak) vs threshold \(threshold)"
                )
            }
        }
    }

    // MARK: - Empty and null data

    func testEmptyHourlyArraysProduceNoData() throws {
        let forecast = try ForecastFixtures.decode(ForecastFixtures.json(hours: []))

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.hasData)
        XCTAssertNil(verdict.maxProbability)
        XCTAssertNil(verdict.peakHour)
        XCTAssertEqual(verdict.sampleCount, 0)
        XCTAssertFalse(verdict.needsUmbrella)
    }

    func testHourlyKeyMissingEntirelyProducesNoData() throws {
        let json = """
        {
          "latitude": 37.5665,
          "longitude": 126.9780,
          "utc_offset_seconds": 32400,
          "timezone": "Asia/Seoul"
        }
        """
        let forecast = try ForecastFixtures.decode(json)

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.hasData)
        XCTAssertFalse(verdict.needsUmbrella)
    }

    func testAllNullProbabilitiesProduceNoData() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: nil)
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.hasData)
        XCTAssertEqual(verdict.sampleCount, 0)
        XCTAssertFalse(verdict.needsUmbrella)
    }

    /// `null` must be skipped, not coerced to 0 — otherwise a mostly-empty
    /// response would quietly read as "no rain".
    func testNullProbabilitiesAreSkippedNotTreatedAsZero() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: nil, overrides: [13: 70, 16: nil])
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertTrue(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 70)
        XCTAssertEqual(verdict.peakHour, 13)
        XCTAssertEqual(verdict.sampleCount, 1, "only the single non-null hour counts")
    }

    func testNoDataNeverNeedsUmbrellaEvenAtZeroThreshold() throws {
        let forecast = try ForecastFixtures.decode(ForecastFixtures.json(hours: []))

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 0,
            now: seoulNow
        )

        XCTAssertFalse(verdict.needsUmbrella)
    }

    // MARK: - Evaluation window (06:00 – 22:00)

    func testHoursOutsideWindowAreIgnored() throws {
        // Downpour at 03:00 and 23:00, dry all day.
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 5, overrides: [3: 100, 23: 100])
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 5)
    }

    func testWindowBoundsAreInclusive() throws {
        let atSix = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 0, overrides: [6: 80])
        )
        XCTAssertEqual(
            UmbrellaDecision.evaluate(forecast: atSix, threshold: 55, now: seoulNow).maxProbability,
            80
        )

        let atTwentyTwo = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 0, overrides: [22: 80])
        )
        XCTAssertEqual(
            UmbrellaDecision.evaluate(forecast: atTwentyTwo, threshold: 55, now: seoulNow)
                .maxProbability,
            80
        )
    }

    func testSampleCountCoversTheWholeWindow() throws {
        let forecast = try ForecastFixtures.decode(ForecastFixtures.fullDay(filler: 10))

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        // 06…22 inclusive.
        XCTAssertEqual(verdict.sampleCount, 17)
    }

    func testCustomWindowIsHonoured() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 0, overrides: [8: 90])
        )

        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: forecast.hourly.time,
            probabilities: forecast.hourly.precipitationProbability,
            threshold: 55,
            window: 9...18,
            localDay: "2026-08-05"
        )

        XCTAssertFalse(verdict.needsUmbrella, "08:00 falls outside a 09–18 window")
    }

    // MARK: - Timezone boundaries

    func testLocalDayUsesForecastOffsetNotDeviceTimezone() {
        // 2026-08-05 22:00 UTC is already 2026-08-06 07:00 in Seoul.
        let instant = TestDate.make(2026, 8, 5, 22, 0, secondsFromGMT: 0)

        XCTAssertEqual(
            UmbrellaDecision.localDay(for: instant, utcOffsetSeconds: 0),
            "2026-08-05"
        )
        XCTAssertEqual(
            UmbrellaDecision.localDay(for: instant, utcOffsetSeconds: 32_400),
            "2026-08-06"
        )
    }

    func testLocalDayHandlesNegativeOffsets() {
        // 2026-08-05 02:00 UTC is still 2026-08-04 22:00 in New York (UTC-4).
        let instant = TestDate.make(2026, 8, 5, 2, 0, secondsFromGMT: 0)

        XCTAssertEqual(
            UmbrellaDecision.localDay(for: instant, utcOffsetSeconds: -14_400),
            "2026-08-04"
        )
    }

    /// The device sits in UTC while the forecast is for Seoul. Just past
    /// midnight Seoul time, "today" must be the Seoul day — evaluating the
    /// previous day's rows would report yesterday's rain.
    func testForecastDayIsSelectedByForecastTimezoneNotDeviceTimezone() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(
                day: "2026-08-06",
                filler: 0,
                overrides: [14: 90],
                utcOffsetSeconds: 32_400
            )
        )

        // 2026-08-05 20:00 UTC == 2026-08-06 05:00 KST.
        let instant = TestDate.make(2026, 8, 5, 20, 0, secondsFromGMT: 0)

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: instant
        )

        XCTAssertTrue(verdict.needsUmbrella)
        XCTAssertEqual(verdict.maxProbability, 90)
    }

    func testRowsFromAnotherDayAreIgnored() throws {
        // Payload describes 2026-08-06 while "now" is still 2026-08-05 in Seoul.
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(day: "2026-08-06", filler: 95)
        )

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: 55,
            now: seoulNow
        )

        XCTAssertFalse(verdict.hasData)
        XCTAssertFalse(verdict.needsUmbrella)
    }

    /// A response spanning a day boundary must only contribute its "today" rows.
    func testMixedDayPayloadOnlyUsesToday() {
        let times = [
            "2026-08-05T20:00",
            "2026-08-05T21:00",
            "2026-08-06T07:00",
            "2026-08-06T15:00",
        ]
        let probabilities: [Int?] = [10, 20, 99, 99]

        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: times,
            probabilities: probabilities,
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.maxProbability, 20)
        XCTAssertFalse(verdict.needsUmbrella)
    }

    // MARK: - Malformed input

    func testMismatchedArrayLengthsUseTheCommonPrefix() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["2026-08-05T09:00", "2026-08-05T10:00", "2026-08-05T11:00"],
            probabilities: [30, 40],
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.maxProbability, 40)
        XCTAssertEqual(verdict.sampleCount, 2)
    }

    func testUnparseableTimestampsAreSkipped() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["", "not-a-date", "2026-08-05", "2026-08-05T99:00", "2026-08-05T12:00"],
            probabilities: [99, 99, 99, 99, 45],
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.maxProbability, 45)
        XCTAssertEqual(verdict.sampleCount, 1)
    }

    func testTimestampsWithSecondsAreAccepted() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["2026-08-05T12:00:00"],
            probabilities: [72],
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.maxProbability, 72)
        XCTAssertEqual(verdict.peakHour, 12)
    }

    func testOutOfRangeProbabilitiesAreClamped() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["2026-08-05T09:00", "2026-08-05T10:00"],
            probabilities: [-20, 140],
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.maxProbability, 100)
        XCTAssertEqual(verdict.peakHour, 10)
    }

    func testThresholdIsClamped() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["2026-08-05T09:00"],
            probabilities: [100],
            threshold: 500,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.threshold, 100)
        XCTAssertTrue(verdict.needsUmbrella, "100% must still satisfy a clamped 100% threshold")
    }

    func testEarliestHourWinsWhenProbabilitiesTie() {
        let verdict = UmbrellaDecision.evaluate(
            hourlyTimes: ["2026-08-05T09:00", "2026-08-05T15:00", "2026-08-05T18:00"],
            probabilities: [80, 80, 80],
            threshold: 55,
            localDay: "2026-08-05"
        )

        XCTAssertEqual(verdict.peakHour, 9)
    }

    // MARK: - Timestamp parser

    func testParserAcceptsWellFormedStamps() {
        XCTAssertEqual(
            UmbrellaDecision.parse("2026-08-05T06:00"),
            UmbrellaDecision.Stamp(day: "2026-08-05", hour: 6)
        )
        XCTAssertEqual(
            UmbrellaDecision.parse("2026-12-31T23:59"),
            UmbrellaDecision.Stamp(day: "2026-12-31", hour: 23)
        )
    }

    func testParserRejectsMalformedStamps() {
        XCTAssertNil(UmbrellaDecision.parse(""))
        XCTAssertNil(UmbrellaDecision.parse("2026-08-05"))
        XCTAssertNil(UmbrellaDecision.parse("2026/08/05T06:00"))
        XCTAssertNil(UmbrellaDecision.parse("20260805T0600"))
        XCTAssertNil(UmbrellaDecision.parse("2026-08-05T24:00"))
        XCTAssertNil(UmbrellaDecision.parse("2026-08-05T6:00"))
        XCTAssertNil(UmbrellaDecision.parse("abcd-ef-ghT06:00"))
    }
}
