import Foundation

/// Pipeline stage, derived purely from file extension — never stored opinion.
public enum Stage: String, Codable, CaseIterable, Sendable {
    case raw
    case denoised
    case export

    public init?(fileExtension ext: String) {
        switch ext.lowercased() {
        case "arw": self = .raw
        case "dng": self = .denoised
        case "jpg", "jpeg", "png": self = .export
        default: return nil
        }
    }

    /// Position in the pipeline; a logical image's stage is its furthest file.
    public var rank: Int {
        switch self {
        case .raw: 0
        case .denoised: 1
        case .export: 2
        }
    }
}

public struct FileRecord: Codable, Equatable, Sendable {
    public let path: String
    public let ext: String
    public let stage: Stage
    public let size: Int64
    public let mtime: Double

    public init(path: String, ext: String, stage: Stage, size: Int64, mtime: Double) {
        self.path = path
        self.ext = ext
        self.stage = stage
        self.size = size
        self.mtime = mtime
    }

    public var stem: String {
        (path as NSString).lastPathComponent.replacingOccurrences(
            of: ".\(ext)", with: "", options: [.caseInsensitive, .anchored, .backwards])
    }
}

/// One logical photo: the same shot across its ARW/DNG/JPG incarnations.
public struct ImageGroup: Codable, Equatable, Sendable {
    public let stem: String
    public let stage: Stage
    /// XMP star rating, 0 = unrated. One rating per logical image.
    public let rating: Int
    /// Upright pixel dimensions of the display file (header-read at scan) so
    /// the grid can lay out before any thumbnail loads. 3:2 when unreadable.
    public let width: Int
    public let height: Int
    public let files: [FileRecord]

    public init(
        stem: String, stage: Stage, rating: Int = 0, width: Int = 3000, height: Int = 2000,
        files: [FileRecord]
    ) {
        self.stem = stem
        self.stage = stage
        self.rating = rating
        self.width = width
        self.height = height
        self.files = files
    }

    /// The file to thumbnail: furthest-stage file wins (exports are what you
    /// delivered; raw embedded previews only when nothing else exists).
    public var displayFile: FileRecord? {
        files.max { $0.stage.rank < $1.stage.rank }
    }
}

public struct Shoot: Codable, Equatable, Sendable {
    public let name: String
    public let path: String
    public let day: String?
    public let project: String?
    public let counts: [String: Int]
    public let imageCount: Int
}

/// `<YYYY-MM-DD>_<project>` → (day, project); anything else is nil.
public func parseShootName(_ name: String) -> (day: String, project: String)? {
    let pattern = /^(\d{4}-\d{2}-\d{2})_(.+)$/
    guard let match = name.wholeMatch(of: pattern) else { return nil }
    return (String(match.1), String(match.2))
}

/// Group files of one shoot into logical images by filename stem.
/// `ratingFor`/`dimensionsFor` supply per-group disk reads (injected so
/// grouping stays testable without disk).
public func buildImageGroups(
    files: [FileRecord],
    ratingFor: ([FileRecord]) -> Int = { _ in 0 },
    dimensionsFor: ([FileRecord]) -> (width: Int, height: Int) = { _ in Dimensions.fallback }
) -> [ImageGroup] {
    let grouped = Dictionary(grouping: files) { $0.stem.lowercased() }
    return grouped.values
        .map { group in
            let sorted = group.sorted { $0.stage.rank < $1.stage.rank }
            let stage = sorted.last?.stage ?? .raw
            let stem = sorted.first?.stem ?? ""
            let dims = dimensionsFor(sorted)
            return ImageGroup(
                stem: stem, stage: stage, rating: ratingFor(sorted),
                width: dims.width, height: dims.height, files: sorted)
        }
        .sorted { $0.stem.localizedStandardCompare($1.stem) == .orderedAscending }
}

/// Per-stage counts of logical images (not files).
public func stageCounts(images: [ImageGroup]) -> [String: Int] {
    var counts: [String: Int] = [:]
    for stage in Stage.allCases {
        counts[stage.rawValue] = 0
    }
    for image in images {
        counts[image.stage.rawValue, default: 0] += 1
    }
    return counts
}

public func makeShoot(name: String, path: String, images: [ImageGroup]) -> Shoot {
    let parsed = parseShootName(name)
    return Shoot(
        name: name,
        path: path,
        day: parsed?.day,
        project: parsed?.project,
        counts: stageCounts(images: images),
        imageCount: images.count)
}
