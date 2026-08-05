import CoreLocation
import Foundation

public enum LocationError: Error, LocalizedError, Equatable {
    case notDetermined
    case denied
    /// The widget extension is not allowed to receive location updates.
    /// Usually means `NSWidgetWantsLocation` is missing, or the user granted
    /// location only while the app itself is in use and has never opened it.
    case widgetNotAuthorized
    case timedOut
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .notDetermined:
            return "위치 권한이 아직 결정되지 않았습니다."
        case .denied:
            return "위치 권한이 거부되어 있습니다. 설정에서 '앱을 사용하는 동안'을 허용해 주세요."
        case .widgetNotAuthorized:
            return "위젯이 위치를 사용할 수 없습니다. 앱을 한 번 실행해 위치 권한을 허용해 주세요."
        case .timedOut:
            return "위치를 확인하는 데 시간이 너무 오래 걸립니다."
        case .failed(let detail):
            return "위치를 확인하지 못했습니다. (\(detail))"
        }
    }
}

/// One-shot location lookups for both targets.
///
/// Deliberately asks for **when-in-use** authorisation only — the app never needs
/// background location, because the widget gets its own location grant through
/// `NSWidgetWantsLocation` in the extension's Info.plist.
///
/// Callers get a plain `Coordinate` rather than a `CLLocation`, which keeps
/// CoreLocation types from leaking into the shared decision/caching layer.
@MainActor
public final class LocationProvider: NSObject {

    public static let shared = LocationProvider()

    private let manager = CLLocationManager()
    private var pending: [CheckedContinuation<Coordinate, Error>] = []
    private var timeoutTask: Task<Void, Never>?
    private var isRequesting = false

    public override init() {
        super.init()
        manager.delegate = self
        // Reduced accuracy is all a city-level rain forecast needs, and it lets
        // the user keep "Precise Location" switched off without breaking the app.
        manager.desiredAccuracy = kCLLocationAccuracyReduced
    }

    // MARK: - Authorisation

    public var authorizationStatus: CLAuthorizationStatus {
        manager.authorizationStatus
    }

    public var isAuthorized: Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return true
        default: return false
        }
    }

    /// Whether a widget timeline build is allowed to ask for location right now.
    /// Must be checked **before** calling `requestCoordinate()` from the extension.
    public var isAuthorizedForWidgetUpdates: Bool {
        manager.isAuthorizedForWidgetUpdates
    }

    /// Presents the system "Allow While Using App" prompt. No-op once answered.
    public func requestWhenInUseAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    // MARK: - One-shot fix

    /// Requests a single location fix.
    ///
    /// Concurrent callers share one underlying `requestLocation()` call. The
    /// timeout exists because `requestLocation()` can stay silent indefinitely
    /// when there is no signal, which would stall a widget timeline build.
    public func requestCoordinate(timeout: TimeInterval = 8) async throws -> Coordinate {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            break
        case .notDetermined:
            throw LocationError.notDetermined
        default:
            throw LocationError.denied
        }

        return try await withCheckedThrowingContinuation { continuation in
            pending.append(continuation)
            guard !isRequesting else { return }
            isRequesting = true
            startTimeout(timeout)
            manager.requestLocation()
        }
    }

    /// Resolves a usable coordinate, falling back to the last one saved in the
    /// App Group when CoreLocation cannot deliver a fresh fix.
    ///
    /// - Returns: `nil` only when there is neither a live fix nor a cached one.
    public func resolveCoordinate(
        store: SharedStore = .shared,
        timeout: TimeInterval = 8
    ) async -> (coordinate: Coordinate, isFallback: Bool)? {
        do {
            let coordinate = try await requestCoordinate(timeout: timeout)
            store.lastKnownCoordinate = coordinate
            return (coordinate, false)
        } catch {
            guard let cached = store.lastKnownCoordinate else { return nil }
            return (cached, true)
        }
    }

    /// Same as `resolveCoordinate`, but refuses to touch CoreLocation when the
    /// widget has not been granted location access. Call this one from the
    /// timeline provider.
    public func resolveCoordinateForWidget(
        store: SharedStore = .shared,
        timeout: TimeInterval = 8
    ) async -> (coordinate: Coordinate, isFallback: Bool)? {
        guard isAuthorizedForWidgetUpdates else {
            guard let cached = store.lastKnownCoordinate else { return nil }
            return (cached, true)
        }
        return await resolveCoordinate(store: store, timeout: timeout)
    }

    // MARK: - Reverse geocoding

    /// Human-readable name for a coordinate, e.g. `"중구"`.
    ///
    /// `CLGeocoder` is rate limited and explicitly discouraged in extensions, so
    /// the result is cached in the App Group and only refreshed once the device
    /// has moved further than `minimumMoveMeters` from the cached point.
    public func placeName(
        for coordinate: Coordinate,
        store: SharedStore = .shared,
        minimumMoveMeters: Double = 3_000
    ) async -> String? {
        if let cachedName = store.lastKnownPlaceName,
           let cachedPoint = store.placeNameCoordinate,
           cachedPoint.distance(to: coordinate) < minimumMoveMeters {
            return cachedName
        }

        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location),
              let placemark = placemarks.first
        else {
            // Keep showing the stale name rather than blanking the widget.
            return store.lastKnownPlaceName
        }

        let name = placemark.subLocality
            ?? placemark.locality
            ?? placemark.administrativeArea
            ?? placemark.name

        if let name {
            store.lastKnownPlaceName = name
            store.placeNameCoordinate = coordinate
        }
        return name ?? store.lastKnownPlaceName
    }

    // MARK: - Internals

    private func startTimeout(_ timeout: TimeInterval) {
        timeoutTask?.cancel()
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(1, timeout) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.finish(with: .failure(LocationError.timedOut))
        }
    }

    /// Resumes every waiting caller exactly once.
    fileprivate func finish(with result: Result<Coordinate, Error>) {
        timeoutTask?.cancel()
        timeoutTask = nil
        isRequesting = false

        let waiting = pending
        pending.removeAll()
        for continuation in waiting {
            continuation.resume(with: result)
        }
    }
}

extension LocationProvider: CLLocationManagerDelegate {

    // Delegate callbacks arrive on the queue the manager was created on (main),
    // but are declared `nonisolated` so the conformance matches CoreLocation's
    // non-isolated protocol. Only `Sendable` values cross the hop.
    public nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let last = locations.last else {
            Task { @MainActor [weak self] in
                self?.finish(with: .failure(LocationError.failed("빈 위치 응답")))
            }
            return
        }
        let coordinate = Coordinate(
            latitude: last.coordinate.latitude,
            longitude: last.coordinate.longitude
        )
        Task { @MainActor [weak self] in
            self?.finish(with: .success(coordinate))
        }
    }

    public nonisolated func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        let description = error.localizedDescription
        Task { @MainActor [weak self] in
            self?.finish(with: .failure(LocationError.failed(description)))
        }
    }

    public nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            // A denial while a request is in flight would otherwise hang until
            // the timeout fires.
            switch status {
            case .denied, .restricted:
                self.finish(with: .failure(LocationError.denied))
            default:
                break
            }
        }
    }
}
