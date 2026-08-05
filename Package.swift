// swift-tools-version: 5.9
import PackageDescription

// A companion SwiftPM package, not the way the app ships.
//
// It exposes the platform-independent half of `Shared/` as a library so the
// decision logic, the schedule planners and the storage layer can be tested with
// `swift test` — on macOS, on Linux, and in CI — without an Xcode project, a
// simulator, or a signing identity. The app and the widget are built from
// Umbrella.xcodeproj, which compiles the same files plus the CoreLocation ones.
let package = Package(
    name: "Umbrella",
    platforms: [
        .iOS(.v17),
        .macOS(.v13),
    ],
    products: [
        .library(name: "UmbrellaCore", targets: ["UmbrellaCore"]),
    ],
    targets: [
        .target(
            name: "UmbrellaCore",
            path: "Shared",
            // CoreLocation is unavailable off Apple platforms, and the refresher
            // is a thin orchestrator over it. Both are still compiled by the
            // app and widget targets in the Xcode project.
            exclude: [
                "LocationProvider.swift",
                "UmbrellaRefresher.swift",
            ]
        ),
        .testTarget(
            name: "UmbrellaCoreTests",
            dependencies: ["UmbrellaCore"],
            path: "UmbrellaTests"
        ),
    ]
)
