import Foundation

/// `photopipe.json`: per-project metadata only; workflow state lives in the files themselves.
public struct ProjectFile: Codable, Equatable, Sendable {
    public var notes: String
    /// Written as `created` on disk so older builds round-trip it instead of dropping it.
    public var day: String?
    /// Rel path of the cover image; nil means "use the first one".
    public var cover: String?

    public init(notes: String = "", day: String? = nil, cover: String? = nil) {
        self.notes = notes
        self.day = day
        self.cover = cover
    }

    private enum CodingKeys: String, CodingKey {
        case notes, cover
        case day = "created"
    }

    public static let fileName = "photopipe.json"

    public static func url(inShoot shootPath: String) -> URL {
        URL(fileURLWithPath: shootPath).appendingPathComponent(fileName)
    }

    /// Missing or corrupt → defaults. Losing this file costs notes, never
    /// the library.
    public static func read(inShoot shootPath: String) -> ProjectFile {
        guard let data = try? Data(contentsOf: url(inShoot: shootPath)),
            let decoded = try? JSONDecoder().decode(ProjectFile.self, from: data)
        else { return ProjectFile() }
        return decoded
    }

    public func write(inShoot shootPath: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: Self.url(inShoot: shootPath), options: .atomic)
    }
}
