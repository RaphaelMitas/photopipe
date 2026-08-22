import Foundation

/// Test-only independent reader: what would Lightroom see? exiftool is the
/// proxy, run one-shot per call. The app itself neither ships nor uses it.
enum ExifToolVerifier {
    enum VerifierError: Error {
        case failed(String)
    }

    static let binary: String? = {
        if let env = ProcessInfo.processInfo.environment["PHOTOPIPE_EXIFTOOL"], !env.isEmpty {
            return env
        }
        var candidates = [
            "/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool", "/opt/local/bin/exiftool",
        ]
        for dir in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            candidates.append("\(dir)/exiftool")
        }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }()

    static var available: Bool { binary != nil }

    static func run(_ args: [String]) throws -> String {
        guard let binary else { throw VerifierError.failed("exiftool not installed") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = args
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = stdout
        try process.run()
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }

    static func tag(_ tag: String, of url: URL) throws -> String {
        try run([tag, "-s3", url.path]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func write(_ args: [String]) throws {
        let output = try run(args)
        let succeeded =
            output.contains("1 image files updated")
            || output.contains("1 image files created")
            || output.contains("1 output files created")
        guard succeeded else { throw VerifierError.failed(output) }
    }
}
