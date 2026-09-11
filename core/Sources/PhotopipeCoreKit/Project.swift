import Foundation

/// `photopipe.json`: per-project metadata only; workflow state lives in the files themselves.
public struct ProjectFile: Codable, Equatable, Sendable {
    public var notes: String
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
        /// How files written before v0.6 spelled `day`.
        case created
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        day = try [
            container.decodeIfPresent(String.self, forKey: .day),
            container.decodeIfPresent(String.self, forKey: .created),
        ].compactMap { $0 }.first(where: isDay)
        cover = try container.decodeIfPresent(String.self, forKey: .cover)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notes, forKey: .notes)
        try container.encodeIfPresent(day, forKey: .day)
        try container.encodeIfPresent(cover, forKey: .cover)
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
