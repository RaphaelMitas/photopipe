// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "PhotopipeCore",
    platforms: [.macOS(.v15), .iOS(.v18)],
    targets: [
        .target(name: "PhotopipeCoreKit"),
        .executableTarget(name: "photopipe-core", dependencies: ["PhotopipeCoreKit"]),
        .testTarget(name: "PhotopipeCoreKitTests", dependencies: ["PhotopipeCoreKit"]),
    ]
)
