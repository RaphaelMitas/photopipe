import Foundation

public let imageExtensions: Set<String> = ["arw", "dng", "jpg", "jpeg", "png"]

public let sidecarExtensions: Set<String> = ["arw"]

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
    public let exposure: Double
    public let width: Int
    public let height: Int

    public init(
        path: String, rel: String, ext: String, size: Int64, mtime: Double,
        rating: Int = 0, exposure: Double = 0, width: Int = 3000, height: Int = 2000
    ) {
        self.path = path
        self.rel = rel
        self.ext = ext
        self.size = size
        self.mtime = mtime
        self.rating = rating
        self.exposure = exposure
        self.width = width
        self.height = height
    }

    public var usesSidecar: Bool {
        sidecarExtensions.contains(ext.lowercased())
    }

    public func with(rating: Int? = nil, exposure: Double? = nil) -> ImageFile {
        ImageFile(
            path: path, rel: rel, ext: ext, size: size, mtime: mtime,
            rating: rating ?? self.rating, exposure: exposure ?? self.exposure,
            width: width, height: height)
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
        coverPath: chosen?.path)
}
