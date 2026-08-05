import Foundation
import WidgetKit

/// One rendered moment of the widget.
///
/// The entry carries a full `UmbrellaSnapshot` rather than loose fields so the
/// widget and the app render from exactly the same value type.
struct UmbrellaEntry: TimelineEntry {
    let date: Date
    let snapshot: UmbrellaSnapshot

    static func placeholder(date: Date = Date()) -> UmbrellaEntry {
        UmbrellaEntry(date: date, snapshot: .placeholder(now: date))
    }
}
