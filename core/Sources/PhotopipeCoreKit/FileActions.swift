import Foundation

public enum FileActions {
    public enum ActionError: Error, Equatable {
        case noFiles
        case openFailed(String)
        case zipFailed(String)
    }

    public static func reveal(paths: [String]) throws {
        guard !paths.isEmpty else { throw ActionError.noFiles }
        let result = try run("/usr/bin/open", ["-R"] + paths)
        guard result.status == 0 else { throw ActionError.openFailed(result.output) }
    }

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

    public static func zipDirectory(at dir: URL, to destination: String) throws {
        let dest = URL(fileURLWithPath: destination)
        let temp = dest.deletingLastPathComponent()
            .appendingPathComponent(".photopipe-\(UUID().uuidString).zip")
        defer { try? FileManager.default.removeItem(at: temp) }
        let result = try run(
            "/usr/bin/zip", ["-q", "-r", temp.path, "."], currentDirectory: dir)
        guard result.status == 0 else { throw ActionError.zipFailed(result.output) }
        if FileManager.default.fileExists(atPath: dest.path) {
            _ = try FileManager.default.replaceItemAt(dest, withItemAt: temp)
        } else {
            try FileManager.default.moveItem(at: temp, to: dest)
        }
    }

    public static func list(zip path: String) throws -> [String] {
        let result = try run("/usr/bin/unzip", ["-Z", "-1", path])
        guard result.status == 0 else { throw ActionError.zipFailed(result.output) }
        return result.output.split(separator: "\n").map(String.init)
    }

    static func uniqueName(_ name: String, isTaken: (String) -> Bool) -> String {
        guard isTaken(name) else { return name }
        let ns = name as NSString
        let base = ns.deletingPathExtension
        let ext = ns.pathExtension
        var index = 1
        while true {
            let candidate = ext.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(ext)"
            if !isTaken(candidate) { return candidate }
            index += 1
        }
    }

    static func uniqueURL(for url: URL) -> URL {
        let dir = url.deletingLastPathComponent()
        let name = uniqueName(url.lastPathComponent) {
            FileManager.default.fileExists(atPath: dir.appendingPathComponent($0).path)
        }
        return dir.appendingPathComponent(name)
    }

    private static func run(
        _ tool: String, _ args: [String], currentDirectory: URL? = nil
    ) throws -> (
        status: Int32, output: String
    ) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        if let currentDirectory { process.currentDirectoryURL = currentDirectory }
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
