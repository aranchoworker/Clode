import Foundation

/// Orchestrates one full refresh: location → forecast → verdict → shared cache.
///
/// Both the app (foreground refresh and `BGAppRefreshTask`) and the widget
/// (timeline build) funnel through here, so there is exactly one definition of
/// what "today's answer" means.
public enum UmbrellaRefresher {

    /// Session shared by every caller in a process — creating a `URLSession` per
    /// fetch is wasteful and, in an extension, measurably slow.
    private static let session = WeatherService.makeDefaultSession()

    /// Runs a refresh and persists the result.
    ///
    /// Never throws: a widget timeline must always end up with *something* to
    /// render. Failures degrade to the cached snapshot, and then to an explicit
    /// "no data" snapshot.
    ///
    /// - Parameter forWidget: when `true`, location is only requested if
    ///   `isAuthorizedForWidgetUpdates` allows it.
    @MainActor
    public static func refresh(
        store: SharedStore = .shared,
        locationProvider: LocationProvider = .shared,
        now: Date = Date(),
        forWidget: Bool = false
    ) async -> UmbrellaSnapshot {

        let settings = store.settings

        let resolved = forWidget
            ? await locationProvider.resolveCoordinateForWidget(store: store)
            : await locationProvider.resolveCoordinate(store: store)

        guard let resolved else {
            // No live fix and nothing cached — we do not even know where to ask.
            return SnapshotFallback.snapshot(
                store: store,
                threshold: settings.threshold,
                coordinate: nil,
                now: now
            )
        }

        let coordinate = resolved.coordinate

        let forecast: OpenMeteoForecast
        do {
            forecast = try await WeatherService(session: session).fetchTodayForecast(
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
        } catch {
            return SnapshotFallback.snapshot(
                store: store,
                threshold: settings.threshold,
                coordinate: coordinate,
                now: now
            )
        }

        let verdict = UmbrellaDecision.evaluate(
            forecast: forecast,
            threshold: settings.threshold,
            now: now
        )

        let placeName = await locationProvider.placeName(for: coordinate, store: store)

        let snapshot = UmbrellaSnapshot(
            verdict: verdict,
            placeName: placeName,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            updatedAt: now,
            origin: .live
        )

        store.snapshot = snapshot
        return snapshot
    }

}
