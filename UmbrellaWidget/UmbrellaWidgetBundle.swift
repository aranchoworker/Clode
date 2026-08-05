import SwiftUI
import WidgetKit

@main
struct UmbrellaWidgetBundle: WidgetBundle {
    var body: some Widget {
        UmbrellaWidget()
    }
}

struct UmbrellaWidget: Widget {

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: AppConstants.widgetKind,
            provider: UmbrellaProvider()
        ) { entry in
            UmbrellaWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("우산 알림")
        .description("오늘 강수확률을 확인하고 우산이 필요한지 알려줍니다.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}
