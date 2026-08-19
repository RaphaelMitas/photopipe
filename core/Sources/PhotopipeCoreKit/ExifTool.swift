import Foundation

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

    static var sandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// The bundle first, and under the sandbox the bundle only: nothing outside
    /// it is reachable there, and reaching for Homebrew would be a review flag
    /// on top of being useless. The rest are dev paths.
    public static func findBinary() -> String? {
        if let bundled = bundledBinary() {
            return bundled
        }
        if sandboxed {
            return nil
        }
        if let env = ProcessInfo.processInfo.environment["PHOTOPIPE_EXIFTOOL"],
            !env.isEmpty
        {
            return env
        }
        let candidates = [
            "/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool", "/opt/local/bin/exiftool",
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        for dir in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            let candidate = "\(dir)/exiftool"
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    /// Resources, not MacOS: codesign demands every file under MacOS be signed
    /// code in its own right, which 250 Perl modules cannot be.
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

    public func execute(_ args: [String]) throws -> String {
        guard !args.contains(where: { $0.contains("\n") }) else {
            throw ExifToolError.failed("argument contains a newline")
        }
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

    public func shutdown() {
        lock.lock()
        defer { lock.unlock() }
        guard let process, process.isRunning else { return }
        stdinPipe?.fileHandleForWriting.write(Data("-stay_open\nFalse\n".utf8))
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
        _ = Self.exitHook

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binary)
        process.arguments = ["-stay_open", "True", "-@", "-"]
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
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
