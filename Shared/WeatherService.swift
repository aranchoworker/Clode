import Foundation

#if canImport(FoundationNetworking)
// swift-corelibs-foundation keeps URLSession in a separate module.
import FoundationNetworking
#endif

public enum WeatherServiceError: Error, LocalizedError, Equatable {
    case invalidURL
    case badStatus(Int)
    /// Open-Meteo answered with its `{"error": true, "reason": …}` payload.
    case api(String)
    case decoding(String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "요청 주소를 만들 수 없습니다."
        case .badStatus(let code):
            return "날씨 서버가 \(code) 응답을 반환했습니다."
        case .api(let reason):
            return "날씨 서버 오류: \(reason)"
        case .decoding(let detail):
            return "날씨 응답을 해석할 수 없습니다. (\(detail))"
        case .transport(let detail):
            return "네트워크 연결에 실패했습니다. (\(detail))"
        }
    }
}

/// Thin async wrapper over the Open-Meteo forecast endpoint.
///
/// Open-Meteo needs no API key and no account, which is why it is used here
/// instead of WeatherKit. Only today's hourly precipitation probability is
/// requested — `timezone=auto` makes the server resolve the location's own
/// timezone so the returned timestamps are already local to the forecast point.
public struct WeatherService: Sendable {

    public static let endpoint = "https://api.open-meteo.com/v1/forecast"

    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    /// A session tuned for widget/background use: short timeouts, because a
    /// timeline build that hangs is worse than one that falls back to cache.
    public static func makeDefaultSession(timeout: TimeInterval = 12) -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout * 2
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }

    /// Builds the request URL. Coordinates are rounded to four decimals (~11 m),
    /// which is far more precision than a daily rain decision needs and keeps the
    /// exact device position out of the query string.
    public static func makeURL(latitude: Double, longitude: Double) -> URL? {
        guard var components = URLComponents(string: endpoint) else { return nil }
        components.queryItems = [
            URLQueryItem(name: "latitude", value: Self.format(latitude)),
            URLQueryItem(name: "longitude", value: Self.format(longitude)),
            URLQueryItem(name: "hourly", value: "precipitation_probability"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "forecast_days", value: "1"),
        ]
        return components.url
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.4f", value)
    }

    /// Fetches today's hourly precipitation probabilities for a coordinate.
    public func fetchTodayForecast(
        latitude: Double,
        longitude: Double
    ) async throws -> OpenMeteoForecast {
        guard let url = Self.makeURL(latitude: latitude, longitude: longitude) else {
            throw WeatherServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw WeatherServiceError.transport(error.localizedDescription)
        }

        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200

        // Open-Meteo reports bad requests with a JSON body worth surfacing.
        if let payload = try? JSONDecoder().decode(OpenMeteoErrorPayload.self, from: data),
           payload.error {
            throw WeatherServiceError.api(payload.reason ?? "알 수 없는 오류")
        }

        guard (200..<300).contains(statusCode) else {
            throw WeatherServiceError.badStatus(statusCode)
        }

        return try Self.decode(data)
    }

    /// Split out so tests can feed hand-written JSON without any networking.
    public static func decode(_ data: Data) throws -> OpenMeteoForecast {
        do {
            return try JSONDecoder().decode(OpenMeteoForecast.self, from: data)
        } catch {
            throw WeatherServiceError.decoding(error.localizedDescription)
        }
    }
}
