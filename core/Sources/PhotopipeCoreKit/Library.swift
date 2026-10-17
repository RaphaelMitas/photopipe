import Foundation
import ImageIO
import UniformTypeIdentifiers

// ImageIO also reads textures, icons and medical scans, which are not photos
private let photoTypes = [
    "public.jpeg", "public.png", "public.tiff", "public.heic", "public.heif", "public.avif",
    "public.jpeg-xl", "org.webmproject.webp",
].compactMap(UTType.init)

/// Every extension whose preferred type ImageIO reads, so a camera a new OS learns needs no release.
private let readableExtensions: [(ext: String, raw: Bool)] = {
    let readable = Set(CGImageSourceCopyTypeIdentifiers() as? [String] ?? [])
    return readable.compactMap(UTType.init).flatMap { $0.tags[.filenameExtension] ?? [] }
        .compactMap { ext in
            // .tif also names an old Canon raw, but a TIFF is what it nearly always is
            guard let type = UTType(filenameExtension: ext), readable.contains(type.identifier)
            else { return nil }
            let raw = type.conforms(to: .rawImage)
            return raw || photoTypes.contains(where: type.conforms) ? (ext, raw) : nil
        }
}()

public let imageExtensions = Set(readableExtensions.map(\.ext))

public let rawExtensions = Set(readableExtensions.filter(\.raw).map(\.ext))

/// What exiftool writes into on the Mac; the rest keep a sidecar on both platforms.
let embeddedExtensions: Set<String> = ["dng", "jpg", "jpeg", "png", "tif", "tiff"]

/// Raws take Lightroom's DSC0001.xmp and are never written into.
public let sidecarOnlyExtensions = rawExtensions.subtracting(embeddedExtensions)

public func isImagePath(_ path: String) -> Bool {
    imageExtensions.contains((path as NSString).pathExtension.lowercased())
}

public struct ImageFile: Encodable, Equatable, Sendable {
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
    /// Capture time in seconds, nil when unknown; filled in on the way out, like `score`.
    public let captured: Double?
    /// Path of the first photo in its stack of near-identical photos, its own path when it stands
    /// alone, nil until the stacking pass has looked at it.
    public let stack: String?
    /// False while the walk's placeholder rating, edit and dimensions are still
    /// standing in for the real ones. Writing an edit against a placeholder
    /// would erase whatever the file actually carries, so the UI must wait.
    public let enriched: Bool
    /// 0 without a sidecar. Writing one leaves the photo's own mtime alone, so only
    /// this marks a cached record stale, including when Lightroom wrote it.
    public let sidecarMtime: Double
    /// Encoded so the UI never keeps a list of its own.
    public let isRaw: Bool

    public init(
        path: String, rel: String, ext: String, size: Int64, mtime: Double,
        rating: Int = 0, edit: Edit = .identity,
        width: Int = Dimensions.fallback.width, height: Int = Dimensions.fallback.height,
        score: Double? = nil, captured: Double? = nil, stack: String? = nil,
        enriched: Bool = false, sidecarMtime: Double = 0
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
        self.captured = captured
        self.stack = stack
        self.enriched = enriched
        self.sidecarMtime = sidecarMtime
        self.isRaw = rawExtensions.contains(ext.lowercased())
    }

    public var sidecarOnly: Bool {
        sidecarOnlyExtensions.contains(ext.lowercased())
    }

    var embedsXMP: Bool {
        embeddedExtensions.contains(ext.lowercased())
    }

    public func with(
        rating: Int? = nil, edit: Edit? = nil,
        dimensions: (width: Int, height: Int)? = nil, enriched: Bool? = nil,
        sidecarMtime: Double? = nil, score: Double? = nil, captured: Double? = nil,
        stack: String? = nil
    ) -> ImageFile {
        ImageFile(
            path: path, rel: rel, ext: ext, size: size, mtime: mtime,
            rating: rating ?? self.rating, edit: edit ?? self.edit,
            width: dimensions?.width ?? self.width, height: dimensions?.height ?? self.height,
            score: score ?? self.score,
            captured: captured ?? self.captured, stack: stack ?? self.stack,
            enriched: enriched ?? self.enriched,
            sidecarMtime: sidecarMtime ?? self.sidecarMtime)
    }
}

public struct Shoot: Codable, Equatable, Sendable {
    public let name: String
    public let path: String
    public let day: String?
    public let imageCount: Int
    public let notes: String
    public let cover: String?
    public let coverPath: String?
    /// Every image in the shoot has real metadata; ratings and dimensions can
    /// be trusted, and the rating filter will not lie.
    public let indexed: Bool
}

public func isDay(_ value: String) -> Bool {
    guard value.wholeMatch(of: /[0-9]{4}-[0-9]{2}-[0-9]{2}/) != nil else { return false }
    let n = value.split(separator: "-").compactMap { Int($0) }
    var parts = DateComponents(year: n[0], month: n[1], day: n[2])
    parts.calendar = Calendar(identifier: .gregorian)
    return parts.isValidDate
}

public func makeShoot(
    name: String, path: String, images: [ImageFile], notes: String, day: String?, cover: String?
) -> Shoot {
    let chosen =
        cover.flatMap { rel in
            images.first { $0.rel.lowercased() == rel.lowercased() }
        } ?? images.first
    return Shoot(
        name: name,
        path: path,
        day: day.flatMap { isDay($0) ? $0 : nil },
        imageCount: images.count,
        notes: notes,
        cover: cover,
        coverPath: chosen?.path,
        indexed: images.allSatisfy(\.enriched))
}
