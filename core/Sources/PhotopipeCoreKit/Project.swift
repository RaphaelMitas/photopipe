import Foundation

/// `photopipe.json`: per-project metadata only; workflow state lives in the files themselves.
public struct ProjectFile: Codable, Equatable, Sendable {
    public var notes: String
    /// YYYY-MM-DD, or nil when undated.
    public var day: String?
    /// Rel path of the cover image; nil means "use the first one".
    public var cover: String?

    public init(notes: String = "", day: String? = nil, cover: String? = nil) {
        self.notes = notes
        self.day = day
        self.cover = cover
    }

    private enum CodingKeys: String, CodingKey {
        case notes, day, cover
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        day = try container.decodeIfPresent(String.self, forKey: .day)
        cover = try container.decodeIfPresent(String.self, forKey: .cover)
    }

    public static let fileName = "photopipe.json"

    public static func url(inShoot shootPath: String) -> URL {
        URL(fileURLWithPath: shootPath).appendingPathComponent(fileName)
    }

    /// Missing → defaults. nil only when a file is there but cannot be read,
    /// so callers know not to write over it.
    public static func read(inShoot shootPath: String) -> ProjectFile? {
        let url = url(inShoot: shootPath)
        guard FileManager.default.fileExists(atPath: url.path) else { return ProjectFile() }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ProjectFile.self, from: data)
    }

    public func write(inShoot shootPath: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(self).write(to: Self.url(inShoot: shootPath), options: .atomic)
    }
}
