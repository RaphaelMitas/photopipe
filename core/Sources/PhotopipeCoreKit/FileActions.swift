import Foundation

/// Actions the user asks for explicitly: hand files to another app, show them
/// in Finder, throw them away, or copy them somewhere. Nothing here happens on
/// its own — Photopipe never moves a file behind your back.
///
/// These shell out to `/usr/bin/open` rather than linking AppKit: the core is
/// a plain CLI sidecar, and `open` is the same mechanism Finder uses.
public enum FileActions {
    public enum ActionError: Error, Equatable {
        case noFiles
        case noApp
        case openFailed(String)
        case zipFailed(String)
    }

    /// Open files in a specific application.
    public static func open(paths: [String], inApp app: String) throws {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        guard !app.isEmpty else { throw ActionError.noApp }
        let result = try run("/usr/bin/open", ["-a", app] + paths)
        guard result.status == 0 else { throw ActionError.openFailed(result.output) }
    }

    /// Select files in Finder.
    public static func reveal(paths: [String]) throws {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        let result = try run("/usr/bin/open", ["-R"] + paths)
        guard result.status == 0 else { throw ActionError.openFailed(result.output) }
    }

    /// Move files to the Trash — recoverable by design. Deleting a photo you
    /// meant to keep must never be final, so this never unlinks.
    /// Returns the paths that actually went.
    @discardableResult
    public static func trash(paths: [String]) throws -> [String] {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        var trashed: [String] = []
        for path in paths where FileManager.default.fileExists(atPath: path) {
            try FileManager.default.trashItem(
                at: URL(fileURLWithPath: path), resultingItemURL: nil)
            trashed.append(path)
        }
        return trashed
    }

    /// Copy files into a destination folder. Existing names get a suffix
    /// rather than being overwritten.
    @discardableResult
    public static func copy(paths: [String], toFolder folder: String) throws -> Int {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        let fm = FileManager.default
        let destination = URL(fileURLWithPath: folder)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        var copied = 0
        for path in paths {
            let source = URL(fileURLWithPath: path)
            let target = uniqueURL(
                for: destination.appendingPathComponent(source.lastPathComponent))
            try fm.copyItem(at: source, to: target)
            copied += 1
        }
        return copied
    }

    /// Zip files flat — no folder structure, because this goes to someone
    /// else. Overwrites, so re-exporting the same delivery is idempotent.
    @discardableResult
    public static func zip(paths: [String], to destination: String) throws -> Int {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        try? FileManager.default.removeItem(atPath: destination)
        // -j junks paths, -q keeps stdout clean for the protocol.
        let result = try run("/usr/bin/zip", ["-j", "-q", destination] + paths)
        guard result.status == 0 else { throw ActionError.zipFailed(result.output) }
        return paths.count
    }

    /// Names inside a zip — used by tests to prove the archive is flat.
    public static func list(zip path: String) throws -> [String] {
        let result = try run("/usr/bin/unzip", ["-Z", "-1", path])
        guard result.status == 0 else { throw ActionError.zipFailed(result.output) }
        return result.output.split(separator: "\n").map(String.init)
    }

    private static func uniqueURL(for url: URL) -> URL {
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        let dir = url.deletingLastPathComponent()
        var index = 1
        var candidate = url
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = dir.appendingPathComponent("\(base)-\(index)").appendingPathExtension(ext)
            index += 1
        }
        return candidate
    }

    private static func run(_ tool: String, _ args: [String]) throws -> (
        status: Int32, output: String
    ) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
