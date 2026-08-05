import Foundation
import XCTest

#if canImport(UmbrellaCore)
@testable import UmbrellaCore
#endif

/// Background-refresh scheduling.
final class BackgroundRefreshPlannerTests: XCTestCase {

    private let offset = 32_400
    private var calendar: Calendar { TestDate.calendar(secondsFromGMT: offset) }

    private func date(_ hour: Int, _ minute: Int = 0, day: Int = 5) -> Date {
        TestDate.make(2026, 8, day, hour, minute, secondsFromGMT: offset)
    }

    func testRefreshIsPlannedAheadOfTodaysReminderWhenStillPossible() {
        let next = BackgroundRefreshPlanner.nextRefreshDate(
            after: date(4, 0),
            settings: AppSettings(notificationHour: 7, notificationMinute: 0),
            calendar: calendar
        )

        XCTAssertEqual(next, date(5, 30), "90 minutes before a 07:00 reminder")
    }

    func testRefreshRollsToTomorrowOnceTodaysWindowHasPassed() {
        let next = BackgroundRefreshPlanner.nextRefreshDate(
            after: date(9, 0),
            settings: AppSettings(notificationHour: 7, notificationMinute: 0),
            calendar: calendar
        )

        XCTAssertEqual(next, date(5, 30, day: 6))
    }

    func testRefreshFollowsACustomReminderTime() {
        let next = BackgroundRefreshPlanner.nextRefreshDate(
            after: date(4, 0),
            settings: AppSettings(notificationHour: 8, notificationMinute: 30),
            calendar: calendar
        )

        XCTAssertEqual(next, date(7, 0))
    }

    func testLeadTimeIsConfigurable() {
        let next = BackgroundRefreshPlanner.nextRefreshDate(
            after: date(4, 0),
            settings: AppSettings(notificationHour: 7, notificationMinute: 0),
            calendar: calendar,
            leadTimeMinutes: 30
        )

        XCTAssertEqual(next, date(6, 30))
    }

    /// A very early reminder pushes the refresh into the previous evening; the
    /// planner must still return a point in the future.
    func testEarlyReminderStillYieldsAFutureRefresh() throws {
        let now = date(0, 0)
        let next = try XCTUnwrap(
            BackgroundRefreshPlanner.nextRefreshDate(
                after: now,
                settings: AppSettings(notificationHour: 0, notificationMinute: 30),
                calendar: calendar
            )
        )

        XCTAssertGreaterThan(next, now)
    }

    func testNextNotificationDateIsTodayWhenTheTimeHasNotPassed() {
        let next = BackgroundRefreshPlanner.nextNotificationDate(
            after: date(6, 0),
            settings: AppSettings(notificationHour: 7, notificationMinute: 0),
            calendar: calendar
        )

        XCTAssertEqual(next, date(7, 0))
    }

    func testNextNotificationDateRollsToTomorrowOncePassed() {
        let next = BackgroundRefreshPlanner.nextNotificationDate(
            after: date(7, 1),
            settings: AppSettings(notificationHour: 7, notificationMinute: 0),
            calendar: calendar
        )

        XCTAssertEqual(next, date(7, 0, day: 6))
    }
}

/// Wall-clock helper used by both planners.
final class CalendarTimeTests: XCTestCase {

    private let offset = 32_400
    private var calendar: Calendar { TestDate.calendar(secondsFromGMT: offset) }

    /// The behaviour that motivated this helper: asking for an earlier time of
    /// day must stay on the same day, not jump forward 24 hours.
    func testEarlierTimeOfDayStaysOnTheSameDay() {
        let afternoon = TestDate.make(2026, 8, 5, 15, 0, secondsFromGMT: offset)

        XCTAssertEqual(
            CalendarTime.time(hour: 6, minute: 30, onSameDayAs: afternoon, calendar: calendar),
            TestDate.make(2026, 8, 5, 6, 30, secondsFromGMT: offset)
        )
    }

    func testMidnightResolvesToTheSameDay() {
        let afternoon = TestDate.make(2026, 8, 5, 15, 0, secondsFromGMT: offset)

        XCTAssertEqual(
            CalendarTime.time(hour: 0, minute: 0, onSameDayAs: afternoon, calendar: calendar),
            TestDate.make(2026, 8, 5, 0, 0, secondsFromGMT: offset)
        )
    }

    func testNextDayCrossesMonthBoundaries() {
        let lastDay = TestDate.make(2026, 8, 31, 23, 0, secondsFromGMT: offset)

        XCTAssertEqual(
            CalendarTime.time(hour: 6, minute: 30, onDayAfter: lastDay, calendar: calendar),
            TestDate.make(2026, 9, 1, 6, 30, secondsFromGMT: offset)
        )
    }
}

/// Display strings shared by the app, the widget and the notification.
final class UmbrellaSnapshotTests: XCTestCase {

    private func snapshot(
        needsUmbrella: Bool,
        probability: Int?,
        threshold: Int = 55,
        placeName: String? = "중구",
        origin: SnapshotOrigin = .live,
        updatedAt: Date = TestDate.make(2026, 8, 5, 7, 12)
    ) -> UmbrellaSnapshot {
        UmbrellaSnapshot(
            needsUmbrella: needsUmbrella,
            probability: probability,
            peakHour: 15,
            threshold: threshold,
            placeName: placeName,
            latitude: 0,
            longitude: 0,
            updatedAt: updatedAt,
            origin: origin
        )
    }

    func testUmbrellaNeededWording() {
        let value = snapshot(needsUmbrella: true, probability: 78)

        XCTAssertEqual(value.headline, "우산 챙기세요")
        XCTAssertEqual(value.probabilityText, "78%")
        XCTAssertEqual(value.summaryLine, "우산 챙기세요 · 78%")
        XCTAssertEqual(value.symbolName, "umbrella.fill")
    }

    func testUmbrellaNotNeededWording() {
        let value = snapshot(needsUmbrella: false, probability: 20)

        XCTAssertEqual(value.headline, "우산 필요 없어요")
        XCTAssertEqual(value.summaryLine, "우산 필요 없어요 · 20%")
        XCTAssertEqual(value.symbolName, "sun.max.fill")
    }

    func testNoDataWording() {
        let value = snapshot(needsUmbrella: false, probability: nil)

        XCTAssertFalse(value.hasData)
        XCTAssertEqual(value.headline, "정보 없음")
        XCTAssertEqual(value.probabilityText, "--")
    }

    func testUpdatedTextIsStableAcrossLocales() {
        let value = snapshot(needsUmbrella: true, probability: 78)
        let text = value.updatedText(
            locale: Locale(identifier: "en_US_POSIX"),
            timeZone: TimeZone(secondsFromGMT: 0)!
        )

        XCTAssertTrue(text.hasPrefix("마지막 갱신 "), text)
        XCTAssertTrue(text.contains("7"), text)
    }

    func testNotificationBodyMentionsPlaceProbabilityAndThreshold() {
        let value = snapshot(needsUmbrella: true, probability: 78, threshold: 55)

        XCTAssertEqual(value.notificationTitle, "☂️ 우산 챙기세요")
        XCTAssertEqual(value.notificationBody, "중구는 오늘 최고 강수확률 78%예요. (기준 55%)")
    }

    func testNotificationBodyWithoutAPlaceName() {
        XCTAssertEqual(
            snapshot(needsUmbrella: true, probability: 78, placeName: nil).notificationBody,
            "오늘 최고 강수확률 78%예요. (기준 55%)"
        )
        XCTAssertEqual(
            snapshot(needsUmbrella: true, probability: 78, placeName: "").notificationBody,
            "오늘 최고 강수확률 78%예요. (기준 55%)"
        )
    }

    func testStalenessFollowsFetchTime() {
        let fetchedAt = TestDate.make(2026, 8, 5, 7, 0)
        let value = snapshot(needsUmbrella: true, probability: 78, updatedAt: fetchedAt)

        XCTAssertFalse(value.isStale(asOf: fetchedAt.addingTimeInterval(60 * 60)))
        XCTAssertTrue(value.isStale(asOf: fetchedAt.addingTimeInterval(7 * 60 * 60)))
    }

    func testVerdictInitialiserCarriesEveryField() {
        let verdict = UmbrellaVerdict(
            needsUmbrella: true,
            maxProbability: 78,
            peakHour: 15,
            sampleCount: 17,
            threshold: 55
        )

        let value = UmbrellaSnapshot(
            verdict: verdict,
            placeName: "중구",
            latitude: 1,
            longitude: 2,
            updatedAt: TestDate.make(2026, 8, 5, 7, 12),
            origin: .live
        )

        XCTAssertTrue(value.needsUmbrella)
        XCTAssertEqual(value.probability, 78)
        XCTAssertEqual(value.peakHour, 15)
        XCTAssertEqual(value.threshold, 55)
        XCTAssertEqual(value.schemaVersion, UmbrellaSnapshot.currentSchemaVersion)
    }
}

/// The offline path: what the user sees when the fetch fails.
final class SnapshotFallbackTests: XCTestCase {

    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: SharedStore!

    override func setUpWithError() throws {
        try super.setUpWithError()
        suiteName = "com.example.umbrella.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        store = SharedStore(defaults: defaults)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        try super.tearDownWithError()
    }

    func testWithoutACacheTheFallbackReportsNoData() {
        let result = SnapshotFallback.snapshot(
            store: store,
            threshold: 55,
            coordinate: Coordinate(latitude: 37.5, longitude: 127.0),
            now: TestDate.make(2026, 8, 5, 9, 0)
        )

        XCTAssertEqual(result.origin, .unavailable)
        XCTAssertFalse(result.hasData)
        XCTAssertFalse(result.needsUmbrella)
    }

    /// Falling back must keep the original fetch time — the widget has to show
    /// when the data is really from, not when the retry happened.
    func testFallbackPreservesTheOriginalFetchTime() {
        let fetchedAt = TestDate.make(2026, 8, 5, 7, 12)
        store.snapshot = UmbrellaSnapshot(
            needsUmbrella: true,
            probability: 78,
            peakHour: 15,
            threshold: 55,
            placeName: "중구",
            latitude: 37.5,
            longitude: 127.0,
            updatedAt: fetchedAt,
            origin: .live
        )

        let result = SnapshotFallback.snapshot(
            store: store,
            threshold: 55,
            coordinate: nil,
            now: TestDate.make(2026, 8, 5, 11, 30)
        )

        XCTAssertEqual(result.updatedAt, fetchedAt)
        XCTAssertEqual(result.origin, .cachedFallback)
        XCTAssertEqual(result.probability, 78)
    }

    /// Changing the threshold while offline must re-judge the cached number
    /// rather than keep showing the old verdict.
    func testFallbackRejudgesTheCachedProbabilityAgainstTheCurrentThreshold() {
        store.snapshot = UmbrellaSnapshot(
            needsUmbrella: false,
            probability: 40,
            peakHour: 15,
            threshold: 55,
            placeName: "중구",
            latitude: 37.5,
            longitude: 127.0,
            updatedAt: TestDate.make(2026, 8, 5, 7, 12),
            origin: .live
        )

        let lowered = SnapshotFallback.snapshot(
            store: store,
            threshold: 30,
            coordinate: nil,
            now: TestDate.make(2026, 8, 5, 11, 30)
        )
        XCTAssertTrue(lowered.needsUmbrella)
        XCTAssertEqual(lowered.threshold, 30)

        let raised = SnapshotFallback.snapshot(
            store: store,
            threshold: 90,
            coordinate: nil,
            now: TestDate.make(2026, 8, 5, 11, 30)
        )
        XCTAssertFalse(raised.needsUmbrella)
    }

    func testFallbackWithoutDataNeverRecommendsAnUmbrella() {
        store.snapshot = UmbrellaSnapshot(
            needsUmbrella: false,
            probability: nil,
            peakHour: nil,
            threshold: 55,
            placeName: nil,
            latitude: 0,
            longitude: 0,
            updatedAt: TestDate.make(2026, 8, 5, 7, 12),
            origin: .live
        )

        let result = SnapshotFallback.snapshot(
            store: store,
            threshold: 0,
            coordinate: nil,
            now: TestDate.make(2026, 8, 5, 11, 30)
        )

        XCTAssertFalse(result.needsUmbrella)
    }
}
