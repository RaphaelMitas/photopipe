import Foundation

public let imageExtensions: Set<String> = ["arw", "dng", "jpg", "jpeg", "png"]

public let rawExtensions: Set<String> = ["arw", "dng", "cr2", "cr3", "nef", "raf", "orf", "rw2"]

public func isImagePath(_ path: String) -> Bool {
    imageExtensions.contains((path as NSString).pathExtension.lowercased())
}

public struct ImageFile: Codable, Equatable, Sendable {
    public let path: String
    public let rel: String
    public let ext: String
    public let size: Int64
    public let mtime: Double
    public let rating: Int
    public let edit: Edit
    public let width: Int
    public let height: Int
    /// Vision's aesthetic score, -1 to 1, or nil when the photo has not been
    /// rated yet. Lives in its own table rather than the file record, so it is
    /// filled in on the way out rather than carried through the snapshot.
    public let score: Double?
    /// False while the walk's placeholder rating, edit and dimensions are still
    /// standing in for the real ones. Writing an edit against a placeholder
    /// would erase whatever the file actually carries, so the UI must wait.
    public let enriched: Bool
    /// Modification time of the `.xmp` beside a raw, or 0 when there is none.
    /// A raw's own bytes never change when its rating does, so this is the only
    /// thing that tells a cached record it has gone stale — including when
    /// Lightroom is what wrote the sidecar.
    public let sidecarMtime: Double

    public init(
        path: String, rel: String, ext: String, size: Int64, mtime: Double,
        rating: Int = 0, edit: Edit = .identity,
        width: Int = Dimensions.fallback.width, height: Int = Dimensions.fallback.height,
        score: Double? = nil, enriched: Bool = false, sidecarMtime: Double = 0
    ) {
        self.path = path
        self.rel = rel
        self.ext = ext
        self.size = size
        self.mtime = mtime
        self.rating = rating
        self.edit = edit
        self.width = width
        self.height = height
        self.score = score
        self.enriched = enriched
        self.sidecarMtime = sidecarMtime
    }

    public var isRaw: Bool {
        rawExtensions.contains(ext.lowercased())
    }

    public func with(
        rating: Int? = nil, edit: Edit? = nil,
        dimensions: (width: Int, height: Int)? = nil, enriched: Bool? = nil,
        sidecarMtime: Double? = nil, score: Double? = nil
    ) -> ImageFile {
        ImageFile(
            path: path, rel: rel, ext: ext, size: size, mtime: mtime,
            rating: rating ?? self.rating, edit: edit ?? self.edit,
            width: dimensions?.width ?? self.width, height: dimensions?.height ?? self.height,
            score: score ?? self.score,
            enriched: enriched ?? self.enriched,
            sidecarMtime: sidecarMtime ?? self.sidecarMtime)
    }
}

public struct Shoot: Codable, Equatable, Sendable {
    public let name: String
    public let path: String
    public let day: String?
    public let project: String?
    public let imageCount: Int
    public let notes: String
    public let cover: String?
    public let coverPath: String?
    /// Every image in the shoot has real metadata; ratings and dimensions can
    /// be trusted, and the rating filter will not lie.
    public let indexed: Bool
}

public func parseShootName(_ name: String) -> (day: String, project: String)? {
    let pattern = /^(\d{4}-\d{2}-\d{2})_(.+)$/
    guard let match = name.wholeMatch(of: pattern) else { return nil }
    return (String(match.1), String(match.2))
}

public func makeShoot(
    name: String, path: String, images: [ImageFile], notes: String = "", cover: String? = nil
) -> Shoot {
    let parsed = parseShootName(name)
    let chosen =
        cover.flatMap { rel in
            images.first { $0.rel.lowercased() == rel.lowercased() }
        } ?? images.first
    return Shoot(
        name: name,
        path: path,
        day: parsed?.day,
        project: parsed?.project,
        imageCount: images.count,
        notes: notes,
        cover: cover,
        coverPath: chosen?.path,
        indexed: images.allSatisfy(\.enriched))
}
