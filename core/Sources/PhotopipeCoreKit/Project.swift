import Foundation

/// `photopipe.json` — per-project *metadata*, and deliberately nothing more.
/// Notes and the creation date live here because no image file can carry
/// them; workflow state never does, because the files themselves are the
/// only truth about where work stands.
public struct ProjectFile: Codable, Equatable, Sendable {
    public var notes: String
    public var created: String?
    /// Rel path of the cover image; nil means "use the first one".
    public var cover: String?

    public init(notes: String = "", created: String? = nil, cover: String? = nil) {
        self.notes = notes
        self.created = created
        self.cover = cover
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
