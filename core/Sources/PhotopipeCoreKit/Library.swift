import Foundation
import ImageIO
import UniformTypeIdentifiers

private let photoTypes = [
    "public.jpeg", "public.png", "public.tiff", "public.heic", "public.heif", "public.avif",
    "public.jpeg-xl", "org.webmproject.webp",
].compactMap(UTType.init)

private let readableExtensions: [(ext: String, raw: Bool)] = {
    let readable = Set(CGImageSourceCopyTypeIdentifiers() as? [String] ?? [])
    return readable.compactMap(UTType.init).flatMap { $0.tags[.filenameExtension] ?? [] }
        .compactMap { ext in
            guard let type = UTType(filenameExtension: ext), readable.contains(type.identifier)
            else { return nil }
            let raw = type.conforms(to: .rawImage)
            return raw || photoTypes.contains(where: type.conforms) ? (ext, raw) : nil
        }
}()

public let imageExtensions = Set(readableExtensions.map(\.ext))

let rawExtensions = Set(readableExtensions.filter(\.raw).map(\.ext))

let xmpEmbeddingExtensions: Set<String> = ["dng", "jpe", "jpg", "jpeg", "png"]

let sidecarOnlyExtensions = rawExtensions.subtracting(xmpEmbeddingExtensions)

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
    public let flag: Int
    public let edit: Edit
    public let width: Int
    public let height: Int
    public let score: Double?
    public let captured: Double?
    public let exif: Exif
    public let stack: String?
    public let enriched: Bool
    public let sidecarMtime: Double
    public let isRaw: Bool
    public let edited: Bool
    public let taken: Double

    public init(
        path: String, rel: String, ext: String, size: Int64, mtime: Double,
        rating: Int = 0, flag: Int = 0, edit: Edit = .identity,
        width: Int = Dimensions.fallback.width, height: Int = Dimensions.fallback.height,
        score: Double? = nil, captured: Double? = nil, exif: Exif = .empty, stack: String? = nil,
        enriched: Bool = false, sidecarMtime: Double = 0
    ) {
        self.path = path
        self.rel = rel
        self.ext = ext
        self.size = size
        self.mtime = mtime
        self.rating = rating
        self.flag = flag
        self.edit = edit
        self.width = width
        self.height = height
        self.score = score
        self.captured = captured
        self.exif = exif
        self.stack = stack
        self.enriched = enriched
        self.sidecarMtime = sidecarMtime
        self.isRaw = rawExtensions.contains(ext.lowercased())
        self.edited = !edit.isIdentity
        taken =
            captured
            ?? mtime + Double(TimeZone.current.secondsFromGMT(for: Date(timeIntervalSince1970: mtime)))
    }

    var sidecarOnly: Bool {
        sidecarOnlyExtensions.contains(ext.lowercased())
    }

    var embedsXMP: Bool {
        xmpEmbeddingExtensions.contains(ext.lowercased())
    }

    public func with(
        rating: Int? = nil, flag: Int? = nil, edit: Edit? = nil,
        dimensions: (width: Int, height: Int)? = nil, enriched: Bool? = nil,
        sidecarMtime: Double? = nil, score: Double? = nil, captured: Double? = nil,
        exif: Exif? = nil, stack: String? = nil
    ) -> ImageFile {
        ImageFile(
            path: path, rel: rel, ext: ext, size: size, mtime: mtime,
            rating: rating ?? self.rating, flag: flag ?? self.flag, edit: edit ?? self.edit,
            width: dimensions?.width ?? self.width, height: dimensions?.height ?? self.height,
            score: score ?? self.score,
            captured: captured ?? self.captured, exif: exif ?? self.exif,
            stack: stack ?? self.stack,
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
