import Foundation

/// Pure scheduling helper deciding *when* the widget should show a new entry.
///
/// Split out of the `TimelineProvider` so the schedule can be unit tested without
/// WidgetKit. Two rules drive it:
///
/// * during the day the widget steps forward every `intervalHours` hours so the
///   "last updated" line keeps moving even if WidgetKit never grants us a reload;
/// * overnight nothing is scheduled — the first entry of a new day lands at
///   06:30, so the widget is correct by the time anyone looks at it in the morning.
public enum TimelinePlanner {

    /// Hour/minute the first entry of a new day should appear at.
    public static let dayStart = (hour: 6, minute: 30)

    /// Last local hour that still gets an intraday entry.
    public static let dayEndHour = 22

    /// Default spacing between intraday entries, in hours.
    public static let defaultIntervalHours = 2

    /// Builds the entry dates for a timeline starting at `now`.
    ///
    /// The first element is always `now` itself, so the widget renders the data we
    /// just fetched immediately. The last element is always tomorrow's 06:30 —
    /// use it as the timeline's reload boundary.
    ///
    /// - Returns: strictly increasing dates, never empty.
    public static func entryDates(
        from now: Date,
        calendar: Calendar,
        intervalHours: Int = defaultIntervalHours,
        dayStart: (hour: Int, minute: Int) = TimelinePlanner.dayStart,
        dayEndHour: Int = TimelinePlanner.dayEndHour
    ) -> [Date] {

        let interval = max(1, intervalHours)
        var dates: [Date] = [now]

        let todayStart = CalendarTime.time(
            hour: dayStart.hour,
            minute: dayStart.minute,
            onSameDayAs: now,
            calendar: calendar
        )

        // Last moment of the day that still deserves an entry (22:00 sharp).
        let todayEnd = CalendarTime.time(
            hour: dayEndHour,
            minute: 0,
            onSameDayAs: now,
            calendar: calendar
        )

        // Before the morning slot, jump straight to it. Otherwise step forward
        // from `now` by one interval.
        var cursor: Date?
        if let todayStart, now < todayStart {
            cursor = todayStart
        } else {
            cursor = calendar.date(byAdding: .hour, value: interval, to: now)
        }

        if let todayEnd {
            // Guard against a pathological calendar returning a non-advancing date.
            var guardCounter = 0
            while let candidate = cursor, candidate <= todayEnd, guardCounter < 24 {
                if candidate > (dates.last ?? now) {
                    dates.append(candidate)
                }
                cursor = calendar.date(byAdding: .hour, value: interval, to: candidate)
                guardCounter += 1
            }
        }

        if let tomorrowStart = nextDayStart(after: now, calendar: calendar, dayStart: dayStart),
           tomorrowStart > (dates.last ?? now) {
            dates.append(tomorrowStart)
        }

        return dates
    }

    /// 06:30 on the day after `now`, in `calendar`'s timezone.
    public static func nextDayStart(
        after now: Date,
        calendar: Calendar,
        dayStart: (hour: Int, minute: Int) = TimelinePlanner.dayStart
    ) -> Date? {
        return CalendarTime.time(
            hour: dayStart.hour,
            minute: dayStart.minute,
            onDayAfter: now,
            calendar: calendar
        )
    }

    /// When WidgetKit should be asked to build a *fresh* timeline (i.e. refetch).
    ///
    /// This is the second entry when one exists — the point at which the data we
    /// are showing is one interval old — otherwise tomorrow morning.
    public static func reloadBoundary(
        for entryDates: [Date],
        now: Date,
        calendar: Calendar
    ) -> Date {
        if entryDates.count > 1 {
            return entryDates[1]
        }
        return nextDayStart(after: now, calendar: calendar)
            ?? now.addingTimeInterval(60 * 60 * 2)
    }
}
