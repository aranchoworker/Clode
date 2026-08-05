import Foundation
import XCTest

#if canImport(UmbrellaCore)
@testable import UmbrellaCore
#endif

/// Decoding and URL construction. No network is touched.
final class WeatherServiceTests: XCTestCase {

    // MARK: - URL

    func testRequestURLCarriesEveryRequiredParameter() throws {
        let url = try XCTUnwrap(WeatherService.makeURL(latitude: 37.5665, longitude: 126.9780))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let items = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) }
        )

        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "api.open-meteo.com")
        XCTAssertEqual(components.path, "/v1/forecast")
        XCTAssertEqual(items["hourly"], "precipitation_probability")
        XCTAssertEqual(items["timezone"], "auto")
        XCTAssertEqual(items["forecast_days"], "1")
        XCTAssertEqual(items["latitude"], "37.5665")
        XCTAssertEqual(items["longitude"], "126.9780")
    }

    /// Open-Meteo is deliberately keyless — nothing resembling a credential
    /// should ever appear in the query string.
    func testRequestURLCarriesNoAPIKey() throws {
        let url = try XCTUnwrap(WeatherService.makeURL(latitude: 1, longitude: 2))
        let query = url.query ?? ""
        for forbidden in ["apikey", "api_key", "appid", "token", "key="] {
            XCTAssertFalse(
                query.lowercased().contains(forbidden),
                "unexpected '\(forbidden)' in \(query)"
            )
        }
    }

    func testCoordinatesAreRoundedToFourDecimals() throws {
        let url = try XCTUnwrap(
            WeatherService.makeURL(latitude: 37.566512345, longitude: -122.987654321)
        )
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let items = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) }
        )

        XCTAssertEqual(items["latitude"], "37.5665")
        XCTAssertEqual(items["longitude"], "-122.9877")
    }

    // MARK: - Decoding

    func testDecodesRepresentativeResponse() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.fullDay(filler: 20, overrides: [15: 80])
        )

        XCTAssertEqual(forecast.timezone, "Asia/Seoul")
        XCTAssertEqual(forecast.utcOffsetSeconds, 32_400)
        XCTAssertEqual(forecast.hourly.time.count, 24)
        XCTAssertEqual(forecast.hourly.precipitationProbability.count, 24)
        XCTAssertEqual(forecast.hourly.precipitationProbability[15], 80)
    }

    func testDecodesNullProbabilitiesAsNil() throws {
        let forecast = try ForecastFixtures.decode(
            ForecastFixtures.json(hours: [(6, 10), (7, nil), (8, 30)])
        )

        XCTAssertEqual(forecast.hourly.precipitationProbability, [10, nil, 30])
    }

    func testDecodesResponseWithoutHourlyKey() throws {
        let forecast = try ForecastFixtures.decode(
            """
            { "latitude": 1.0, "longitude": 2.0, "utc_offset_seconds": 0, "timezone": "UTC" }
            """
        )

        XCTAssertTrue(forecast.hourly.time.isEmpty)
        XCTAssertTrue(forecast.hourly.precipitationProbability.isEmpty)
    }

    func testDecodingGarbageThrowsDecodingError() {
        let data = Data("not json at all".utf8)

        XCTAssertThrowsError(try WeatherService.decode(data)) { error in
            guard case WeatherServiceError.decoding = error else {
                return XCTFail("expected .decoding, got \(error)")
            }
        }
    }

    func testErrorPayloadIsRecognised() throws {
        let json = """
        { "error": true, "reason": "Latitude must be in range of -90 to 90°." }
        """
        let payload = try JSONDecoder().decode(
            OpenMeteoErrorPayload.self,
            from: Data(json.utf8)
        )

        XCTAssertTrue(payload.error)
        XCTAssertEqual(payload.reason, "Latitude must be in range of -90 to 90°.")
    }
}
