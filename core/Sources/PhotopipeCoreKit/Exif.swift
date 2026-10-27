import Foundation
import ImageIO

/// What the camera recorded about the shot. Every field is nil when the file does not carry it.
public struct Exif: Codable, Equatable, Sendable {
    /// Seconds.
    public var shutter: Double?
    public var aperture: Double?
    public var iso: Int?
    /// Millimetres, as the lens reports it, not the 35 mm equivalent.
    public var focal: Double?
    public var lens: String?
    public var body: String?

    public init(
        shutter: Double? = nil, aperture: Double? = nil, iso: Int? = nil, focal: Double? = nil,
        lens: String? = nil, body: String? = nil
    ) {
        self.shutter = shutter
        self.aperture = aperture
        self.iso = iso
        self.focal = focal
        self.lens = lens
        self.body = body
    }

    init(_ props: [CFString: Any]) {
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        let aux = props[kCGImagePropertyExifAuxDictionary] as? [CFString: Any] ?? [:]
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        self.init(
            shutter: Self.positive(exif[kCGImagePropertyExifExposureTime]),
            aperture: Self.positive(exif[kCGImagePropertyExifFNumber]),
            // a CR3 leaves ISOSpeedRatings empty and records ISOSpeed instead
            iso: [
                (exif[kCGImagePropertyExifISOSpeedRatings] as? [Int])?.first,
                exif[kCGImagePropertyExifISOSpeed] as? Int,
                exif[kCGImagePropertyExifRecommendedExposureIndex] as? Int,
            ].lazy.compactMap { $0 }.first { $0 > 0 },
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
