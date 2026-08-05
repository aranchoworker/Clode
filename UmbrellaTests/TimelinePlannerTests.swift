import Foundation
import XCTest

#if canImport(UmbrellaCore)
@testable import UmbrellaCore
#endif

/// The widget refresh schedule. All cases run in a fixed UTC+9 calendar so the
/// expectations do not depend on the machine running them.
final class TimelinePlannerTests: XCTestCase {

    private let offset = 32_400
    private var calendar: Calendar { TestDate.calendar(secondsFromGMT: offset) }

    private func date(_ hour: Int, _ minute: Int = 0, day: Int = 5) -> Date {
        TestDate.make(2026, 8, day, hour, minute, secondsFromGMT: offset)
    }

    // MARK: - Shape

    func testFirstEntryIsAlwaysNow() {
        let now = date(7, 12)
        XCTAssertEqual(TimelinePlanner.entryDates(from: now, calendar: calendar).first, now)
    }

    func testEntriesAreStrictlyIncreasing() {
        for hour in 0...23 {
            let dates = TimelinePlanner.entryDates(from: date(hour, 17), calendar: calendar)
            for pair in zip(dates, dates.dropFirst()) {
                XCTAssertLessThan(pair.0, pair.1, "not increasing at hour \(hour)")
            }
        }
    }

    /// "자정 이후 첫 엔트리는 06:30" — whatever time the timeline is built, the
    /// last entry is the next morning's 06:30 slot.
    func testLastEntryIsAlwaysTomorrowMorning() {
        for hour in 0...23 {
            let dates = TimelinePlanner.entryDates(from: date(hour, 40), calendar: calendar)
            XCTAssertEqual(
                dates.last,
                date(6, 30, day: 6),
                "unexpected final entry when built at \(hour):40"
            )
        }
    }

    // MARK: - Intraday spacing

    func testDaytimeEntriesStepEveryTwoHoursUntilTwentyTwo() {
        let dates = TimelinePlanner.entryDates(from: date(7, 12), calendar: calendar)

        XCTAssertEqual(
            dates,
            [
                date(7, 12),
                date(9, 12),
                date(11, 12),
                date(13, 12),
                date(15, 12),
                date(17, 12),
                date(19, 12),
                date(21, 12),
                date(6, 30, day: 6),
            ]
        )
    }

    func testIntervalIsConfigurable() {
        let dates = TimelinePlanner.entryDates(
            from: date(8, 0),
            calendar: calendar,
            intervalHours: 3
        )

        XCTAssertEqual(
            dates,
            [
                date(8, 0),
                date(11, 0),
                date(14, 0),
                date(17, 0),
                date(20, 0),
                date(6, 30, day: 6),
            ]
        )
    }

    func testNoEntryIsScheduledPastTwentyTwo() {
        let dates = TimelinePlanner.entryDates(from: date(7, 12), calendar: calendar)
        let sameDay = dates.filter { $0 < date(0, 0, day: 6) }
        let cutoff = date(22, 0)

        for entry in sameDay {
            XCTAssertLessThanOrEqual(entry, cutoff)
        }
    }

    // MARK: - Night and early morning

    /// Built before the morning slot, the schedule jumps straight to 06:30
    /// rather than stepping from the current time.
    func testBeforeMorningSlotTheNextEntryIsSixThirty() {
        let dates = TimelinePlanner.entryDates(from: date(5, 0), calendar: calendar)

        XCTAssertEqual(dates[0], date(5, 0))
        XCTAssertEqual(dates[1], date(6, 30))
        XCTAssertEqual(dates[2], date(8, 30))
    }

    /// Built late in the evening there is nothing left to do today: the widget
    /// stays put until tomorrow morning.
    func testLateEveningSchedulesOnlyTomorrowMorning() {
        let dates = TimelinePlanner.entryDates(from: date(23, 30), calendar: calendar)

        XCTAssertEqual(dates, [date(23, 30), date(6, 30, day: 6)])
    }

    func testJustAfterTwentyTwoSchedulesOnlyTomorrowMorning() {
        let dates = TimelinePlanner.entryDates(from: date(22, 1), calendar: calendar)

        XCTAssertEqual(dates, [date(22, 1), date(6, 30, day: 6)])
    }

    func testNoEntriesFallInsideTheOvernightGap() {
        let dates = TimelinePlanner.entryDates(from: date(21, 0), calendar: calendar)
        let gapStart = date(22, 0)
        let gapEnd = date(6, 30, day: 6)

        for entry in dates where entry > gapStart {
            XCTAssertGreaterThanOrEqual(entry, gapEnd, "\(entry) lands in the overnight gap")
        }
    }

    // MARK: - Reload boundary

    func testReloadBoundaryIsTheNextIntradayEntry() {
        let now = date(7, 12)
        let dates = TimelinePlanner.entryDates(from: now, calendar: calendar)

        XCTAssertEqual(
            TimelinePlanner.reloadBoundary(for: dates, now: now, calendar: calendar),
            date(9, 12)
        )
    }

    func testReloadBoundaryOvernightIsTomorrowMorning() {
        let now = date(23, 30)
        let dates = TimelinePlanner.entryDates(from: now, calendar: calendar)

        XCTAssertEqual(
            TimelinePlanner.reloadBoundary(for: dates, now: now, calendar: calendar),
            date(6, 30, day: 6)
        )
    }

    func testReloadBoundaryFallsBackWhenTimelineHasOneEntry() {
        let now = date(12, 0)

        XCTAssertEqual(
            TimelinePlanner.reloadBoundary(for: [now], now: now, calendar: calendar),
            date(6, 30, day: 6)
        )
    }

    // MARK: - Month and year boundaries

    func testRollsOverToTheNextMonth() {
        let now = TestDate.make(2026, 8, 31, 23, 0, secondsFromGMT: offset)
        let dates = TimelinePlanner.entryDates(from: now, calendar: calendar)

        XCTAssertEqual(dates.last, TestDate.make(2026, 9, 1, 6, 30, secondsFromGMT: offset))
    }

    func testRollsOverToTheNextYear() {
        let now = TestDate.make(2026, 12, 31, 23, 0, secondsFromGMT: offset)
        let dates = TimelinePlanner.entryDates(from: now, calendar: calendar)

        XCTAssertEqual(dates.last, TestDate.make(2027, 1, 1, 6, 30, secondsFromGMT: offset))
    }
}
