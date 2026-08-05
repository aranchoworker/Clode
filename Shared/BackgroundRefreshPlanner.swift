import Foundation

/// Decides when the app should ask iOS for its next background refresh.
///
/// Pure so the schedule can be unit tested without `BGTaskScheduler`.
///
/// The goal is to have fresh data *before* the morning reminder is due: iOS
/// treats `earliestBeginDate` as a hint and routinely runs the task later than
/// requested, so we aim a comfortable margin ahead of the notification time.
public enum BackgroundRefreshPlanner {

    /// How far ahead of the notification time we aim to refresh.
    public static let defaultLeadTimeMinutes = 90

    /// Next moment worth waking up for, given the user's reminder time.
    ///
    /// - Returns: the lead-time point before today's reminder if that is still in
    ///   the future, otherwise the one before tomorrow's.
    public static func nextRefreshDate(
        after now: Date,
        settings: AppSettings,
        calendar: Calendar,
        leadTimeMinutes: Int = defaultLeadTimeMinutes
    ) -> Date? {
        guard let todayAlarm = CalendarTime.time(
            hour: settings.notificationHour,
            minute: settings.notificationMinute,
            onSameDayAs: now,
            calendar: calendar
        ) else { return nil }

        let lead = TimeInterval(-leadTimeMinutes * 60)

        let todayTarget = todayAlarm.addingTimeInterval(lead)
        if todayTarget > now {
            return todayTarget
        }

        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: todayAlarm) else {
            return nil
        }
        return tomorrow.addingTimeInterval(lead)
    }

    /// Next occurrence of the reminder time itself, used when scheduling the
    /// local notification.
    ///
    /// - Returns: today's reminder time when it is still ahead of `now`,
    ///   otherwise tomorrow's.
    public static func nextNotificationDate(
        after now: Date,
        settings: AppSettings,
        calendar: Calendar
    ) -> Date? {
        guard let todayAlarm = CalendarTime.time(
            hour: settings.notificationHour,
            minute: settings.notificationMinute,
            onSameDayAs: now,
            calendar: calendar
        ) else { return nil }

        if todayAlarm > now { return todayAlarm }
        return CalendarTime.time(
            hour: settings.notificationHour,
            minute: settings.notificationMinute,
            onDayAfter: now,
            calendar: calendar
        )
    }
}
