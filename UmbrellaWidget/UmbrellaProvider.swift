import Foundation
import WidgetKit

/// Builds the widget's timeline.
///
/// Refresh strategy (see README for the user-facing version):
///
/// * one entry for "right now", so a reload paints the data we just fetched;
/// * further entries every 2 hours until 22:00 — these re-render the same
///   forecast with a fresh "last updated" line, which keeps the widget honest
///   even when WidgetKit declines to run us again;
/// * nothing overnight: the next entry after the evening is tomorrow at 06:30;
/// * `.after(...)` asks WidgetKit to build a *new* timeline (i.e. hit the
///   network again) at the next 2-hour mark.
struct UmbrellaProvider: TimelineProvider {

    func placeholder(in context: Context) -> UmbrellaEntry {
        .placeholder()
    }

    /// Shown in the widget gallery and for transient system snapshots. Must
    /// return quickly, so this never touches the network.
    func getSnapshot(in context: Context, completion: @escaping (UmbrellaEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder())
            return
        }

        let now = Date()
        let store = SharedStore.shared
        let snapshot = store.snapshot ?? UmbrellaSnapshot.unavailable(
            threshold: store.settings.threshold,
            placeName: store.lastKnownPlaceName,
            latitude: store.lastKnownCoordinate?.latitude ?? 0,
            longitude: store.lastKnownCoordinate?.longitude ?? 0,
            now: now
        )
        completion(UmbrellaEntry(date: now, snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UmbrellaEntry>) -> Void) {
        Task { @MainActor in
            let now = Date()

            // `forWidget: true` makes the refresher honour
            // `isAuthorizedForWidgetUpdates` before touching CoreLocation.
            let snapshot = await UmbrellaRefresher.refresh(now: now, forWidget: true)

            let calendar = Calendar.current
            let dates = TimelinePlanner.entryDates(from: now, calendar: calendar)
            let entries = dates.map { UmbrellaEntry(date: $0, snapshot: snapshot) }
            let boundary = TimelinePlanner.reloadBoundary(
                for: dates,
                now: now,
                calendar: calendar
            )

            completion(Timeline(entries: entries, policy: .after(boundary)))
        }
    }
}
