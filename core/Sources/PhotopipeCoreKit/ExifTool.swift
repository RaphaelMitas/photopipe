import Foundation

/// Persistent `exiftool -stay_open` daemon. A per-write process spawn costs
/// ~150ms of Perl startup — far too slow for keyboard-speed culling — so one
/// long-lived process serves all writes at a few milliseconds each.
/// `@unchecked Sendable`: all mutable state is guarded by `lock`.
public final class ExifTool: @unchecked Sendable {
    public enum ExifToolError: Error {
        case notInstalled
        case failed(String)
    }

    public static let shared = ExifTool()

    private let lock = NSLock()
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var executeCount = 0

    /// Resolution order: env override → the copy bundled beside us in the app
    /// → Homebrew/MacPorts → PATH.
    ///
    /// The bundled copy comes first because it is the only one a shipped app
    /// can count on: ratings are what this app writes into your files, and
    /// they must work on a Mac that has never installed anything. The later
    /// candidates keep `swift test` working from a checkout.
    public static func findBinary() -> String? {
        if let env = ProcessInfo.processInfo.environment["PHOTOPIPE_EXIFTOOL"],
            !env.isEmpty
        {
            return env
        }
        if let bundled = bundledBinary() {
            return bundled
        }
        let candidates = [
            "/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool", "/opt/local/bin/exiftool",
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        // Last resort: search PATH.
        for dir in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            let candidate = "\(dir)/exiftool"
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    /// This sidecar runs from `Contents/MacOS`, and Tauri stages bundle
    /// resources in `Contents/Resources`, so the vendored copy is one hop up
    /// and over.
    static func bundledBinary() -> String? {
        guard let exe = Bundle.main.executableURL?.resolvingSymlinksInPath() else { return nil }
        let candidate =
            exe
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/exiftool/exiftool")
        return FileManager.default.isExecutableFile(atPath: candidate.path)
            ? candidate.path : nil
    }

    public var available: Bool { Self.findBinary() != nil }

    /// Run one exiftool command (argument list, no shell) through the daemon.
    /// Returns stdout. Throws when exiftool reports no file written/created.
    public func execute(_ args: [String]) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        try ensureRunning()
        guard let stdin = stdinPipe?.fileHandleForWriting,
            let stdout = stdoutPipe?.fileHandleForReading
        else { throw ExifToolError.failed("daemon pipes missing") }

        executeCount += 1
        let marker = "{ready\(executeCount)}"
        var command = args.joined(separator: "\n")
        command += "\n-execute\(executeCount)\n"
        stdin.write(Data(command.utf8))

        var buffer = Data()
        while true {
            let chunk = stdout.availableData
            if chunk.isEmpty {
                // Daemon died mid-command; next call respawns it.
                terminate()
                throw ExifToolError.failed("exiftool daemon exited")
            }
            buffer.append(chunk)
            if let text = String(data: buffer, encoding: .utf8),
                let range = text.range(of: marker)
            {
                return String(text[..<range.lowerBound])
            }
        }
    }

    /// Write, asserting exiftool actually updated/created a file.
    public func write(_ args: [String]) throws {
        let output = try execute(args)
        let succeeded =
            output.contains("1 image files updated")
            || output.contains("1 image files created")
            || output.contains("1 output files created")
        guard succeeded else {
            throw ExifToolError.failed(
                output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "exiftool wrote nothing" : output)
        }
    }

    /// Stop the daemon politely. Called from the exit hook and by the core's
    /// shutdown path; safe to call when nothing is running.
    public func shutdown() {
        lock.lock()
        defer { lock.unlock() }
        guard let process, process.isRunning else { return }
        stdinPipe?.fileHandleForWriting.write(Data("-stay_open\nFalse\n".utf8))
        // Give it a moment to exit on its own, then insist.
        let deadline = Date().addingTimeInterval(0.5)
        while process.isRunning && Date() < deadline {
            usleep(10_000)
        }
        if process.isRunning { process.terminate() }
        self.process = nil
        stdinPipe = nil
        stdoutPipe = nil
    }

    private func ensureRunning() throws {
        if let process, process.isRunning { return }
        guard let binary = Self.findBinary() else { throw ExifToolError.notInstalled }
        // The daemon must never outlive us: an orphaned perl process holds
        // inherited fds open and can wedge whatever pipeline spawned this
        // process (observed hanging `swift test | tail`).
        _ = Self.exitHook

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = ["-stay_open", "True", "-@", "-"]
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        // Stderr flows to the core's stderr: visible in logs, never parsed.
        try process.run()
        self.process = process
        self.stdinPipe = stdinPipe
        self.stdoutPipe = stdoutPipe
    }

    private static let exitHook: Void = {
        atexit { ExifTool.shared.shutdown() }
    }()

    private func terminate() {
        process?.terminate()
        process = nil
        stdinPipe = nil
        stdoutPipe = nil
    }

    deinit {
        if let process, process.isRunning {
            stdinPipe?.fileHandleForWriting.write(Data("-stay_open\nFalse\n".utf8))
            process.terminate()
        }
    }
}
