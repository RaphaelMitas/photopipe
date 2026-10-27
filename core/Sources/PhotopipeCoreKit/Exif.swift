import Foundation
import ImageIO

public struct Exif: Codable, Equatable, Sendable {
    // seconds
    public var shutter: Double?
    public var aperture: Double?
    public var iso: Int?
    // mm, not the 35 mm equivalent
    public var focal: Double?
    public var lens: String?
    public var body: String?
}

extension Exif {
    public static let empty = Exif()

    init(_ props: [CFString: Any]) {
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        let aux = props[kCGImagePropertyExifAuxDictionary] as? [CFString: Any] ?? [:]
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        self.init(
            shutter: Self.positive(exif[kCGImagePropertyExifExposureTime]),
            aperture: Self.positive(exif[kCGImagePropertyExifFNumber]),
            // ISOSpeedRatings stops at 65535 and a CR3 leaves it empty; the others carry the rest
            iso: [
                (exif[kCGImagePropertyExifISOSpeedRatings] as? [Int])?.first,
                exif[kCGImagePropertyExifISOSpeed] as? Int,
                exif[kCGImagePropertyExifRecommendedExposureIndex] as? Int,
            ].compactMap { $0 }.max().flatMap { $0 > 0 ? $0 : nil },
            focal: Self.positive(exif[kCGImagePropertyExifFocalLength]),
            lens: Self.text(exif[kCGImagePropertyExifLensModel])
                ?? Self.text(aux[kCGImagePropertyExifAuxLensModel]),
            body: Self.text(tiff[kCGImagePropertyTIFFModel]))
    }

    private static func positive(_ value: Any?) -> Double? {
        guard let number = value as? Double, number.isFinite, number > 0 else { return nil }
        return number
    }

    private static func text(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines.union(.controlCharacters))
        return trimmed.isEmpty ? nil : trimmed
    }
}
