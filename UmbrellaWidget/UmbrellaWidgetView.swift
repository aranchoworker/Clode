import SwiftUI
import UIKit
import WidgetKit

/// Routes each widget family to its own layout.
struct UmbrellaWidgetEntryView: View {

    @Environment(\.widgetFamily) private var family
    let entry: UmbrellaEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            InlineUmbrellaView(entry: entry)
        case .accessoryRectangular:
            RectangularUmbrellaView(entry: entry)
        case .systemMedium:
            MediumUmbrellaView(entry: entry)
        default:
            SmallUmbrellaView(entry: entry)
        }
    }
}

// MARK: - Shared styling

/// Background treatment for the home screen families.
///
/// Colour alone never carries the meaning — the symbol and the wording say it
/// too — so the widget still reads correctly in tinted mode, where the system
/// desaturates everything.
private struct UmbrellaBackground: View {
    let needsUmbrella: Bool
    let hasData: Bool

    var body: some View {
        if !hasData {
            Color(uiColor: .systemGray5)
        } else if needsUmbrella {
            LinearGradient(
                colors: [
                    Color(red: 0.16, green: 0.36, blue: 0.72),
                    Color(red: 0.09, green: 0.22, blue: 0.50),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else {
            LinearGradient(
                colors: [Color(uiColor: .secondarySystemBackground), Color(uiColor: .systemBackground)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

/// Foreground colour paired with `UmbrellaBackground`.
private func primaryTextColor(needsUmbrella: Bool, hasData: Bool) -> Color {
    (hasData && needsUmbrella) ? .white : .primary
}

private func secondaryTextColor(needsUmbrella: Bool, hasData: Bool) -> Color {
    (hasData && needsUmbrella) ? Color.white.opacity(0.8) : .secondary
}

/// "중구 · 마지막 갱신 07:12", plus an offline marker when we are showing cache.
private struct FooterView: View {
    let snapshot: UmbrellaSnapshot
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            if snapshot.origin != .live {
                Image(systemName: "clock.arrow.circlepath")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            Text(footerText)
                .font(.caption2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(color)
    }

    private var footerText: String {
        if let place = snapshot.placeName, !place.isEmpty {
            return "\(place) · \(snapshot.updatedText())"
        }
        return snapshot.updatedText()
    }
}

// MARK: - systemSmall

private struct SmallUmbrellaView: View {
    let entry: UmbrellaEntry

    private var snapshot: UmbrellaSnapshot { entry.snapshot }

    var body: some View {
        let primary = primaryTextColor(
            needsUmbrella: snapshot.needsUmbrella,
            hasData: snapshot.hasData
        )
        let secondary = secondaryTextColor(
            needsUmbrella: snapshot.needsUmbrella,
            hasData: snapshot.hasData
        )

        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: snapshot.symbolName)
                .font(.title2)
                .foregroundStyle(primary)
                .widgetAccentable()
                .accessibilityHidden(true)

            Spacer(minLength: 0)

            Text(snapshot.probabilityText)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(primary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            Text(snapshot.headline)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            FooterView(snapshot: snapshot, color: secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            UmbrellaBackground(
                needsUmbrella: snapshot.needsUmbrella,
                hasData: snapshot.hasData
            )
        }
        .widgetURL(AppConstants.widgetTapURL)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: snapshot))
    }
}

// MARK: - systemMedium

private struct MediumUmbrellaView: View {
    let entry: UmbrellaEntry

    private var snapshot: UmbrellaSnapshot { entry.snapshot }

    var body: some View {
        let primary = primaryTextColor(
            needsUmbrella: snapshot.needsUmbrella,
            hasData: snapshot.hasData
        )
        let secondary = secondaryTextColor(
            needsUmbrella: snapshot.needsUmbrella,
            hasData: snapshot.hasData
        )

        HStack(spacing: 16) {
            VStack(spacing: 2) {
                Image(systemName: snapshot.symbolName)
                    .font(.system(size: 30))
                    .widgetAccentable()
                    .accessibilityHidden(true)
                Text(snapshot.probabilityText)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .foregroundStyle(primary)
            .frame(width: 92)

            VStack(alignment: .leading, spacing: 5) {
                Text(snapshot.headline)
                    .font(.headline)
                    .foregroundStyle(primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(detailText)
                    .font(.caption)
                    .foregroundStyle(secondary)
                    .lineLimit(2)

                Spacer(minLength: 0)

                FooterView(snapshot: snapshot, color: secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            UmbrellaBackground(
                needsUmbrella: snapshot.needsUmbrella,
                hasData: snapshot.hasData
            )
        }
        .widgetURL(AppConstants.widgetTapURL)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: snapshot))
    }

    private var detailText: String {
        guard snapshot.hasData else {
            return "날씨 정보를 불러오지 못했어요. 앱을 열어 다시 시도해 보세요."
        }
        let window = AppDefaults.evaluationWindow
        var parts: [String] = ["오늘 \(window.lowerBound)–\(window.upperBound)시 최고 강수확률"]
        if let peak = snapshot.peakHourText {
            parts.append(peak)
        }
        parts.append("기준 \(snapshot.threshold)%")
        return parts.joined(separator: " · ")
    }
}

// MARK: - accessoryRectangular (lock screen)

private struct RectangularUmbrellaView: View {
    let entry: UmbrellaEntry

    private var snapshot: UmbrellaSnapshot { entry.snapshot }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: snapshot.symbolName)
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Text(snapshot.headline)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .widgetAccentable()

            Text(subtitle)
                .font(.caption)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            Text(snapshot.updatedText())
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        // Lock-screen families are always rendered on the wallpaper, so the
        // container background stays empty rather than drawing a colour.
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(AppConstants.widgetTapURL)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(for: snapshot))
    }

    private var subtitle: String {
        if let place = snapshot.placeName, !place.isEmpty {
            return "\(snapshot.probabilityText) · \(place)"
        }
        return snapshot.probabilityText
    }
}

// MARK: - accessoryInline (lock screen / above the clock)

private struct InlineUmbrellaView: View {
    let entry: UmbrellaEntry

    var body: some View {
        // Inline widgets get a single line and the system's own styling; any
        // font or colour set here is ignored.
        Label(
            "\(entry.snapshot.probabilityText) \(entry.snapshot.headline)",
            systemImage: entry.snapshot.symbolName
        )
        .widgetURL(AppConstants.widgetTapURL)
    }
}

// MARK: - Accessibility

private func accessibilityLabel(for snapshot: UmbrellaSnapshot) -> String {
    guard snapshot.hasData else {
        return "강수 정보를 불러오지 못했습니다."
    }
    var text = "오늘 최고 강수확률 \(snapshot.probabilityText). \(snapshot.headline)."
    if let place = snapshot.placeName, !place.isEmpty {
        text += " 위치 \(place)."
    }
    text += " \(snapshot.updatedText())."
    return text
}

// MARK: - Previews

#Preview("Small – 우산 필요", as: .systemSmall) {
    UmbrellaWidget()
} timeline: {
    UmbrellaEntry(date: .now, snapshot: .placeholder())
}

#Preview("Small – 맑음", as: .systemSmall) {
    UmbrellaWidget()
} timeline: {
    UmbrellaEntry(
        date: .now,
        snapshot: UmbrellaSnapshot(
            needsUmbrella: false,
            probability: 20,
            peakHour: 14,
            threshold: 55,
            placeName: "중구",
            latitude: 0,
            longitude: 0,
            updatedAt: .now,
            origin: .live
        )
    )
}

#Preview("Medium", as: .systemMedium) {
    UmbrellaWidget()
} timeline: {
    UmbrellaEntry(date: .now, snapshot: .placeholder())
}

#Preview("Rectangular", as: .accessoryRectangular) {
    UmbrellaWidget()
} timeline: {
    UmbrellaEntry(date: .now, snapshot: .placeholder())
}

#Preview("Inline", as: .accessoryInline) {
    UmbrellaWidget()
} timeline: {
    UmbrellaEntry(date: .now, snapshot: .placeholder())
}
