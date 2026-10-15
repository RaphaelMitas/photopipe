// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "PhotopipeCore",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "PhotopipeCoreFFI", type: .static, targets: ["PhotopipeCoreFFI"])
    ],
    targets: [
        .target(name: "PhotopipeCoreKit"),
        .target(name: "PhotopipeCoreFFI", dependencies: ["PhotopipeCoreKit"]),
        .testTarget(name: "PhotopipeCoreKitTests", dependencies: ["PhotopipeCoreKit"]),
    ]
)
