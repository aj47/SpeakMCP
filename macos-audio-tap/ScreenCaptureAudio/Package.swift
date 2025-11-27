// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ScreenCaptureAudio",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "screencapture-audio", targets: ["ScreenCaptureAudio"])
    ],
    targets: [
        .executableTarget(
            name: "ScreenCaptureAudio",
            path: "Sources"
        )
    ]
)

