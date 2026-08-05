import Foundation

/// Deterministic wall-clock arithmetic.
///
/// `Calendar.date(bySettingHour:minute:second:of:)` resolves through a search
/// whose anchor and direction are easy to get wrong. Building the date from
/// explicit year/month/day + hour/minute components leaves nothing to interpret,
/// which matters because the widget schedule and the reminder time both depend
/// on getting "today at HH:MM" exactly right.
public enum CalendarTime {

    /// `HH:MM:00` on the same calendar day as `day`, in `calendar`'s timezone.
    public static func time(
        hour: Int,
        minute: Int,
        onSameDayAs day: Date,
        calendar: Calendar
    ) -> Date? {
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        components.hour = hour
        components.minute = minute
        components.second = 0
        return calendar.date(from: components)
    }

    /// `HH:MM:00` on the day after `day`.
    public static func time(
        hour: Int,
        minute: Int,
        onDayAfter day: Date,
        calendar: Calendar
    ) -> Date? {
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: day) else { return nil }
        return time(hour: hour, minute: minute, onSameDayAs: tomorrow, calendar: calendar)
    }
}
