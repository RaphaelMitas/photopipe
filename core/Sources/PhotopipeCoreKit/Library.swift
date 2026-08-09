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
    /// From photopipe.json; empty when the project has none.
    public let notes: String
    /// Stem of the chosen cover, if the project names one.
    public let cover: String?
    /// File to thumbnail for the project's cover: the chosen image, else the
    /// first one. Nil only when the project has no images at all.
    public let coverPath: String?
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
/// Does `derived` extend `anchor` past a separator — `dsc00001-dxo` from
/// `dsc00001`, but never `dsc00010` from `dsc0001` (the boundary is a digit)?
func stemExtends(_ derived: String, anchor: String) -> Bool {
    guard derived.count > anchor.count, derived.hasPrefix(anchor) else { return false }
    let boundary = derived[derived.index(derived.startIndex, offsetBy: anchor.count)]
    return !boundary.isLetter && !boundary.isNumber
}

public func buildImageGroups(
    files: [FileRecord],
    ratingFor: ([FileRecord]) -> Int = { _ in 0 },
    dimensionsFor: ([FileRecord]) -> (width: Int, height: Int) = { _ in Dimensions.fallback }
) -> [ImageGroup] {
    let exact = Dictionary(grouping: files) { $0.stem.lowercased() }

    // Originals anchor the groups. A derived file whose (renamed) stem
    // extends an original's stem — "DSC00001-DxO" from "DSC00001", the way
    // denoisers name their output — joins that original's group; longest
    // anchor wins. A derived file matching nothing stands alone.
    var anchored: [String: [FileRecord]] = [:]
    var derived: [(key: String, files: [FileRecord])] = []
    for (key, group) in exact {
        if group.contains(where: { $0.stage == .raw }) {
            anchored[key] = group
        } else {
            derived.append((key, group))
        }
    }
    for (key, group) in derived {
        let match = anchored.keys
            .filter { stemExtends(key, anchor: $0) }
            .max { $0.count < $1.count }
        if let match {
            anchored[match, default: []].append(contentsOf: group)
        } else {
            anchored[key] = group
        }
    }

    return anchored.values
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

public func makeShoot(
    name: String, path: String, images: [ImageGroup], notes: String = "", cover: String? = nil
) -> Shoot {
    let parsed = parseShootName(name)
    // A named cover that no longer exists falls back to the first image
    // rather than leaving the card blank.
    let chosen =
        cover.flatMap { stem in
            images.first { $0.stem.lowercased() == stem.lowercased() }
        } ?? images.first
    return Shoot(
        name: name,
        path: path,
        day: parsed?.day,
        project: parsed?.project,
        counts: stageCounts(images: images),
        imageCount: images.count,
        notes: notes,
        cover: cover,
        coverPath: chosen?.displayFile?.path)
}
