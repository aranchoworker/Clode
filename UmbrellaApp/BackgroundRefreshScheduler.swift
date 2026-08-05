import BackgroundTasks
import Foundation
import WidgetKit

/// Registers and schedules the early-morning `BGAppRefreshTask`.
///
/// The task fetches the forecast ahead of the reminder time, arms the
/// notification, and reloads the widget timelines so the home screen is already
/// correct when the user first looks at it.
///
/// iOS decides when — or whether — to run it. Everything downstream is written
/// to tolerate the task never running.
enum BackgroundRefreshScheduler {

    /// Must be called during app launch, before the app finishes launching.
    /// Registering later throws.
    static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: AppConstants.backgroundRefreshTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask)
        }
    }

    /// Asks iOS for the next wake-up. Call after launch and whenever the
    /// reminder time changes.
    static func schedule(now: Date = Date(), calendar: Calendar = .current) {
        let settings = SharedStore.shared.settings
        guard let beginDate = BackgroundRefreshPlanner.nextRefreshDate(
            after: now,
            settings: settings,
            calendar: calendar
        ) else { return }

        let request = BGAppRefreshTaskRequest(
            identifier: AppConstants.backgroundRefreshTaskIdentifier
        )
        request.earliestBeginDate = beginDate

        // Submitting throws when the identifier is not declared in Info.plist
        // under BGTaskSchedulerPermittedIdentifiers, or on Simulator where
        // background scheduling is unavailable. Neither is fatal.
        do {
            BGTaskScheduler.shared.cancel(
                taskRequestWithIdentifier: AppConstants.backgroundRefreshTaskIdentifier
            )
            try BGTaskScheduler.shared.submit(request)
        } catch {
            #if DEBUG
            print("[Umbrella] BGAppRefreshTask 예약 실패: \(error.localizedDescription)")
            #endif
        }
    }

    private static func handle(_ task: BGAppRefreshTask) {
        // Chain the next one immediately: a task only ever runs once per submit.
        schedule()

        let finisher = TaskFinisher(task: task)

        // The expiration handler is installed before any work starts, so an
        // immediate expiration cannot slip through unhandled.
        let work = Task { @MainActor in
            let store = SharedStore.shared
            let snapshot = await UmbrellaRefresher.refresh(store: store)
            await NotificationScheduler.reschedule(
                snapshot: snapshot,
                settings: store.settings
            )
            WidgetCenter.shared.reloadAllTimelines()
            finisher.complete(success: snapshot.origin == .live)
        }

        task.expirationHandler = {
            work.cancel()
            finisher.complete(success: false)
        }
    }
}

/// Guarantees `setTaskCompleted` is called exactly once — calling it twice
/// (normal completion racing the expiration handler) terminates the app.
private final class TaskFinisher: @unchecked Sendable {
    private let lock = NSLock()
    private var isFinished = false
    private let task: BGTask

    init(task: BGTask) {
        self.task = task
    }

    func complete(success: Bool) {
        lock.lock()
        let alreadyFinished = isFinished
        isFinished = true
        lock.unlock()

        guard !alreadyFinished else { return }
        task.setTaskCompleted(success: success)
    }
}
