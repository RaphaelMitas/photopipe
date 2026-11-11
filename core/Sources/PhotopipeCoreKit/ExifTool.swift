import Foundation
import Synchronization

#if os(macOS)

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
        /// Readable without `lock`, which a stuck write may hold while the app exits.
        private let pid = Atomic<Int32>(0)

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
            for dir in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
                let candidate = "\(dir)/exiftool"
                if FileManager.default.isExecutableFile(atPath: candidate) {
                    return candidate
                }
            }
            return nil
        }

        static func bundledBinary(
            executable: URL? = Bundle.main.executableURL?.resolvingSymlinksInPath()
        ) -> String? {
            guard let exe = executable else { return nil }
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
            // a dead exiftool is EPIPE (the app ignores SIGPIPE), which write(_:) would raise as an ObjC exception
            try stdin.write(contentsOf: Data(command.utf8))

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

        private func ensureRunning() throws {
            if let process, process.isRunning { return }
            guard let binary = Self.findBinary() else { throw ExifToolError.notInstalled }

            let process = Process()
            process.executableURL = URL(fileURLWithPath: binary)
            let config = FileManager.default.temporaryDirectory
                .appendingPathComponent("photopipe-exiftool.config")
            try Data(Self.config.utf8).write(to: config, options: .atomic)
            // exiftool only takes -config as its very first argument
            process.arguments = ["-config", config.path, "-stay_open", "True", "-@", "-"]
            let stdinPipe = Pipe()
            let stdoutPipe = Pipe()
            process.standardInput = stdinPipe
            process.standardOutput = stdoutPipe
            try process.run()
            pid.store(process.processIdentifier, ordering: .relaxed)
            _ = Self.exitHook
            self.process = process
            self.stdinPipe = stdinPipe
            self.stdoutPipe = stdoutPipe
        }

        // exiftool refuses to write a namespace it has no table for
        private static let config = """
            %Image::ExifTool::UserDefined::photopipe = (
                GROUPS => { 0 => 'XMP', 1 => 'XMP-photopipe', 2 => 'Image' },
                NAMESPACE => { 'photopipe' => '\(XMP.TagWrite.Namespace.photopipe.uri)' },
                WRITABLE => 'string',
                Masks => { },
            );
            %Image::ExifTool::UserDefined = (
                'Image::ExifTool::XMP::Main' => {
                    photopipe => {
                        SubDirectory => { TagTable => 'Image::ExifTool::UserDefined::photopipe' },
                    },
                },
            );
            1;

            """

        // exiftool outlives a closed stdin, and would hold the app's stderr open after it exits;
        // SIGINT, because only that one makes it delete a half-written temp file
        private static let exitHook: Void = {
            atexit {
                let pid = ExifTool.shared.pid.load(ordering: .relaxed)
                if pid > 0 { kill(pid, SIGINT) }
            }
        }()

        private func terminate() {
            process?.terminate()
            process = nil
            pid.store(0, ordering: .relaxed)
            stdinPipe = nil
            stdoutPipe = nil
        }
    }

    extension ExifTool.ExifToolError: WireError {
        public var wire: ResponseError {
            switch self {
            case .notInstalled:
                ResponseError(
                    code: "exiftool_missing",
                    message: "exiftool not found — install it or set PHOTOPIPE_EXIFTOOL")
            case .failed(let output): ResponseError(code: "exiftool_failed", message: output)
            }
        }
    }
#endif
