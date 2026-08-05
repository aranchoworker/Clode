import Foundation
import XCTest

#if canImport(UmbrellaCore)
@testable import UmbrellaCore
#endif

/// Storage round-trips, run against a throwaway suite rather than the real
/// App Group.
final class SharedStoreTests: XCTestCase {

    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: SharedStore!

    override func setUpWithError() throws {
        try super.setUpWithError()
        suiteName = "com.example.umbrella.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        store = SharedStore(defaults: defaults)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        store = nil
        defaults = nil
        suiteName = nil
        try super.tearDownWithError()
    }

    // MARK: - Settings

    func testDefaultsAreUsedWhenNothingHasBeenStored() {
        let settings = store.settings

        XCTAssertEqual(settings.threshold, AppDefaults.threshold)
        XCTAssertEqual(settings.threshold, 55, "the product default is 55%")
        XCTAssertEqual(settings.notificationHour, 7)
        XCTAssertEqual(settings.notificationMinute, 0)
        XCTAssertTrue(settings.notificationsEnabled)
    }

    func testSettingsRoundTrip() {
        store.settings = AppSettings(
            threshold: 30,
            notificationsEnabled: false,
            notificationHour: 6,
            notificationMinute: 45
        )

        let reloaded = SharedStore(defaults: defaults).settings

        XCTAssertEqual(reloaded.threshold, 30)
        XCTAssertFalse(reloaded.notificationsEnabled)
        XCTAssertEqual(reloaded.notificationHour, 6)
        XCTAssertEqual(reloaded.notificationMinute, 45)
    }

    /// A stored threshold of 0 is a legitimate choice ("always tell me"), so it
    /// must survive the round trip instead of being mistaken for "unset".
    func testZeroThresholdIsDistinguishedFromUnset() {
        store.settings = AppSettings(threshold: 0)

        XCTAssertEqual(SharedStore(defaults: defaults).settings.threshold, 0)
    }

    /// Likewise `notificationsEnabled == false` must not read back as the
    /// `true` default.
    func testDisabledNotificationsSurviveRoundTrip() {
        store.settings = AppSettings(notificationsEnabled: false)

        XCTAssertFalse(SharedStore(defaults: defaults).settings.notificationsEnabled)
    }

    func testOutOfRangeValuesAreClamped() {
        let high = AppSettings(threshold: 500, notificationHour: 99, notificationMinute: 120)
        XCTAssertEqual(high.threshold, 100)
        XCTAssertEqual(high.notificationHour, 23)
        XCTAssertEqual(high.notificationMinute, 59)

        let low = AppSettings(threshold: -40, notificationHour: -3, notificationMinute: -1)
        XCTAssertEqual(low.threshold, 0)
        XCTAssertEqual(low.notificationHour, 0)
        XCTAssertEqual(low.notificationMinute, 0)
    }

    func testClampingAlsoAppliesOnPropertyAssignment() {
        var settings = AppSettings()
        settings.threshold = 300
        settings.notificationHour = 40

        XCTAssertEqual(settings.threshold, 100)
        XCTAssertEqual(settings.notificationHour, 23)
    }

    // MARK: - Snapshot cache

    func testSnapshotRoundTrip() throws {
        let original = UmbrellaSnapshot(
            needsUmbrella: true,
            probability: 78,
            peakHour: 15,
            threshold: 55,
            placeName: "중구",
            latitude: 37.5665,
            longitude: 126.9780,
            updatedAt: TestDate.make(2026, 8, 5, 7, 12),
            origin: .live
        )

        store.snapshot = original
        let reloaded = try XCTUnwrap(SharedStore(defaults: defaults).snapshot)

        XCTAssertEqual(reloaded, original)
    }

    func testSnapshotCanBeCleared() {
        store.snapshot = .placeholder()
        store.snapshot = nil

        XCTAssertNil(SharedStore(defaults: defaults).snapshot)
    }

    /// A blob written by an incompatible build must read back as "no cache"
    /// rather than crashing the widget.
    func testSnapshotWithUnknownSchemaVersionIsDiscarded() throws {
        var future = UmbrellaSnapshot.placeholder()
        future.schemaVersion = UmbrellaSnapshot.currentSchemaVersion + 1

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        defaults.set(try encoder.encode(future), forKey: SharedDefaultsKey.cachedSnapshot)

        XCTAssertNil(store.snapshot)
    }

    func testCorruptSnapshotDataIsDiscarded() {
        defaults.set(Data("garbage".utf8), forKey: SharedDefaultsKey.cachedSnapshot)

        XCTAssertNil(store.snapshot)
    }

    // MARK: - Location cache

    func testLastKnownCoordinateRoundTrip() throws {
        store.lastKnownCoordinate = Coordinate(latitude: 37.5665, longitude: 126.9780)

        let reloaded = try XCTUnwrap(SharedStore(defaults: defaults).lastKnownCoordinate)
        XCTAssertEqual(reloaded.latitude, 37.5665, accuracy: 0.00001)
        XCTAssertEqual(reloaded.longitude, 126.9780, accuracy: 0.00001)
    }

    func testLastKnownCoordinateIsNilUntilSet() {
        XCTAssertNil(store.lastKnownCoordinate)
    }

    func testClearingCoordinateRemovesBothComponents() {
        store.lastKnownCoordinate = Coordinate(latitude: 1, longitude: 2)
        store.lastKnownCoordinate = nil

        XCTAssertNil(store.lastKnownCoordinate)
        XCTAssertNil(defaults.object(forKey: SharedDefaultsKey.lastKnownLatitude))
        XCTAssertNil(defaults.object(forKey: SharedDefaultsKey.lastKnownLongitude))
    }

    func testPlaceNameRoundTrip() {
        store.lastKnownPlaceName = "중구"
        store.placeNameCoordinate = Coordinate(latitude: 37.5665, longitude: 126.9780)

        let reloaded = SharedStore(defaults: defaults)
        XCTAssertEqual(reloaded.lastKnownPlaceName, "중구")
        XCTAssertNotNil(reloaded.placeNameCoordinate)
    }

    // MARK: - Coordinate distance

    func testDistanceIsZeroForTheSamePoint() {
        let point = Coordinate(latitude: 37.5665, longitude: 126.9780)
        XCTAssertEqual(point.distance(to: point), 0, accuracy: 0.001)
    }

    /// One degree of latitude is roughly 111 km anywhere on Earth — enough to
    /// confirm the approximation is in the right units and order of magnitude.
    func testDistanceApproximatesOneDegreeOfLatitude() {
        let from = Coordinate(latitude: 37.0, longitude: 127.0)
        let to = Coordinate(latitude: 38.0, longitude: 127.0)

        XCTAssertEqual(from.distance(to: to), 111_000, accuracy: 2_000)
    }

    func testDistanceDetectsASmallMove() {
        let from = Coordinate(latitude: 37.5665, longitude: 126.9780)
        let to = Coordinate(latitude: 37.5665, longitude: 126.9880)

        // ~880 m at this latitude: below the 3 km geocoder refresh threshold.
        XCTAssertLessThan(from.distance(to: to), 3_000)
        XCTAssertGreaterThan(from.distance(to: to), 100)
    }
}
