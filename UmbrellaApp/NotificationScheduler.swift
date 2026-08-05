import Foundation
import UserNotifications

/// Manages the single daily "take an umbrella" reminder.
///
/// The reminder is **conditional** — it must only fire on days where the
/// forecast actually crosses the threshold. A repeating
/// `UNCalendarNotificationTrigger` cannot express that, so instead the request is
/// re-planned after every successful refresh: a one-shot notification is armed
/// for today's reminder time when (and only when) today's verdict says umbrella,
/// and removed again otherwise.
///
/// The consequence, documented in the README, is that the reminder depends on a
/// background refresh having run that morning. Erring towards a missed reminder
/// is deliberate — a false "take an umbrella" is worse than a silent day.
enum NotificationScheduler {

    private static var center: UNUserNotificationCenter { .current() }

    // MARK: - Authorisation

    @discardableResult
    static func requestAuthorization() async -> Bool {
        do {
            return try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    static func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    // MARK: - Scheduling

    /// Re-plans the reminder from the latest verdict. Safe to call as often as
    /// you like — it always clears the previous request first.
    static func reschedule(
        snapshot: UmbrellaSnapshot,
        settings: AppSettings,
        now: Date = Date(),
        calendar: Calendar = .current
    ) async {
        cancel()

        guard settings.notificationsEnabled else { return }
        guard snapshot.hasData, snapshot.needsUmbrella else { return }
        guard await authorizationStatus() == .authorized else { return }

        // Only arm today's reminder: tomorrow's forecast is not fetched, so a
        // request for tomorrow would be based on today's numbers.
        guard let fireDate = CalendarTime.time(
            hour: settings.notificationHour,
            minute: settings.notificationMinute,
            onSameDayAs: now,
            calendar: calendar
        ), fireDate > now else { return }

        let content = UNMutableNotificationContent()
        content.title = snapshot.notificationTitle
        content.body = snapshot.notificationBody
        content.sound = .default

        let components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: fireDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

        let request = UNNotificationRequest(
            identifier: AppConstants.dailyNotificationIdentifier,
            content: content,
            trigger: trigger
        )
        try? await center.add(request)
    }

    static func cancel() {
        center.removePendingNotificationRequests(
            withIdentifiers: [AppConstants.dailyNotificationIdentifier]
        )
    }
}
