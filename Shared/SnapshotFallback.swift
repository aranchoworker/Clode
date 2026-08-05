import Foundation

/// What to show when a fetch fails.
///
/// Kept in its own file — free of CoreLocation and WidgetKit — so the offline
/// behaviour can be unit tested directly. `UmbrellaRefresher` is the only caller.
public enum SnapshotFallback {

    /// The best answer available without a successful fetch.
    ///
    /// The cached probability is re-judged against the *current* threshold, so
    /// changing the setting takes effect immediately even while offline.
    public static func snapshot(
        store: SharedStore,
        threshold: Int,
        coordinate: Coordinate?,
        now: Date
    ) -> UmbrellaSnapshot {
        guard var cached = store.snapshot else {
            return .unavailable(
                threshold: threshold,
                placeName: store.lastKnownPlaceName,
                latitude: coordinate?.latitude ?? 0,
                longitude: coordinate?.longitude ?? 0,
                now: now
            )
        }

        cached.origin = .cachedFallback
        cached.threshold = threshold
        cached.needsUmbrella = cached.probability.map { $0 >= threshold } ?? false
        // `updatedAt` intentionally keeps the original fetch time — the widget
        // must show when the data is really from, not when we last retried.
        return cached
    }
}
