import Foundation

/// Decoded shape of the Open-Meteo `/v1/forecast` response we request.
///
/// Only the fields this app actually uses are modelled. Open-Meteo returns the
/// hourly timestamps as *naive local time* strings (e.g. `"2026-08-05T06:00"`)
/// when `timezone=auto` is used, together with `utc_offset_seconds` describing
/// which offset those strings are expressed in. Keeping them as strings — rather
/// than eagerly turning them into `Date` — is deliberate: the umbrella decision
/// only ever cares about "which local day / which local hour", so string parsing
/// keeps it free of `Calendar` and locale surprises.
public struct OpenMeteoForecast: Codable, Equatable, Sendable {

    public let latitude: Double
    public let longitude: Double

    /// IANA identifier resolved by the API, e.g. `"Asia/Seoul"`.
    public let timezone: String

    /// Offset that `hourly.time` strings are expressed in, e.g. `32400` for KST.
    public let utcOffsetSeconds: Int

    public let hourly: Hourly

    public struct Hourly: Codable, Equatable, Sendable {
        /// Naive local timestamps, e.g. `"2026-08-05T06:00"`.
        public let time: [String]

        /// Precipitation probability in percent. Individual entries can be
        /// `null` when the model has no value for that hour.
        public let precipitationProbability: [Int?]

        public init(time: [String], precipitationProbability: [Int?]) {
            self.time = time
            self.precipitationProbability = precipitationProbability
        }

        private enum CodingKeys: String, CodingKey {
            case time
            case precipitationProbability = "precipitation_probability"
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.time = try container.decodeIfPresent([String].self, forKey: .time) ?? []
            self.precipitationProbability =
                try container.decodeIfPresent([Int?].self, forKey: .precipitationProbability) ?? []
        }
    }

    public init(
        latitude: Double,
        longitude: Double,
        timezone: String,
        utcOffsetSeconds: Int,
        hourly: Hourly
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.timezone = timezone
        self.utcOffsetSeconds = utcOffsetSeconds
        self.hourly = hourly
    }

    private enum CodingKeys: String, CodingKey {
        case latitude
        case longitude
        case timezone
        case utcOffsetSeconds = "utc_offset_seconds"
        case hourly
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.latitude = try container.decodeIfPresent(Double.self, forKey: .latitude) ?? 0
        self.longitude = try container.decodeIfPresent(Double.self, forKey: .longitude) ?? 0
        self.timezone = try container.decodeIfPresent(String.self, forKey: .timezone) ?? "UTC"
        self.utcOffsetSeconds = try container.decodeIfPresent(Int.self, forKey: .utcOffsetSeconds) ?? 0
        self.hourly = try container.decodeIfPresent(Hourly.self, forKey: .hourly)
            ?? Hourly(time: [], precipitationProbability: [])
    }
}

/// Open-Meteo signals failures with `{"error": true, "reason": "..."}` and an
/// HTTP 400, rather than with the normal forecast payload.
struct OpenMeteoErrorPayload: Decodable {
    let error: Bool
    let reason: String?
}
