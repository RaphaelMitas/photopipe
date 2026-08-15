import Foundation
import ImageIO

public enum XMP {
    public static func sidecarURL(forImagePath path: String) -> URL {
        URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("xmp")
    }

    public static func readSidecarRating(at url: URL) -> Int? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return parseRating(text)
    }

    static func parseRating(_ text: String) -> Int? {
        if let match = text.firstMatch(of: /xmp:Rating\s*=\s*"(-?\d+)"/) {
            return Int(match.1)
        }
        if let match = text.firstMatch(of: /<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/) {
            return Int(match.1)
        }
        return nil
    }

    // Exponents appear in foreign sidecars; non-finite values must never
    // reach the edit model (they poison JSON encoding and CI geometry).
    private static let number = "([-+]?[\\d.]+(?:[eE][-+]?\\d+)?)"

    static func parseDouble(_ tag: String, in text: String) -> Double? {
        let attribute = try? Regex("crs:\(tag)\\s*=\\s*\"\(number)\"")
        if let attribute, let match = text.firstMatch(of: attribute),
            let value = match[1].substring, let parsed = Double(value), parsed.isFinite
        {
            return parsed
        }
        let element = try? Regex("<crs:\(tag)>\\s*\(number)\\s*</crs:\(tag)>")
        if let element, let match = text.firstMatch(of: element),
            let value = match[1].substring, let parsed = Double(value), parsed.isFinite
        {
            return parsed
        }
        return nil
    }

    static func parseHasCrop(in text: String) -> Bool? {
        let attribute = try? Regex("crs:HasCrop\\s*=\\s*\"(\\w+)\"")
        if let attribute, let match = text.firstMatch(of: attribute),
            let value = match[1].substring
        {
            return value.lowercased() == "true"
        }
        let element = try? Regex("<crs:HasCrop>\\s*(\\w+)\\s*</crs:HasCrop>")
        if let element, let match = text.firstMatch(of: element),
            let value = match[1].substring
        {
            return value.lowercased() == "true"
        }
        return nil
    }

    static func parseCurve(_ tag: String, in text: String) -> [CurvePoint] {
        let block = try? Regex("<crs:\(tag)>(.*?)</crs:\(tag)>").dotMatchesNewlines()
        guard let block, let match = text.firstMatch(of: block),
            let body = match[1].substring
        else { return [] }
        return body.matches(of: /<rdf:li>\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/rdf:li>/)
            .compactMap { item in
                guard let x = Double(item.1), let y = Double(item.2) else { return nil }
                return CurvePoint(x: x / 255, y: y / 255)
            }
    }

    static func parseEdit(_ text: String, isRaw: Bool, baseOrientation: Int = 1) -> Edit {
        Edit(
            exposure: parseDouble("Exposure2012", in: text) ?? 0,
            highlights: parseDouble("Highlights2012", in: text) ?? 0,
            shadows: parseDouble("Shadows2012", in: text) ?? 0,
            temperature: parseDouble(isRaw ? "Temperature" : "IncrementalTemperature", in: text),
            tint: parseDouble(isRaw ? "Tint" : "IncrementalTint", in: text),
            vibrance: parseDouble("Vibrance", in: text) ?? 0,
            saturation: parseDouble("Saturation", in: text) ?? 0,
            curveRGB: parseCurve("ToneCurvePV2012", in: text),
            curveRed: parseCurve("ToneCurvePV2012Red", in: text),
            curveGreen: parseCurve("ToneCurvePV2012Green", in: text),
            curveBlue: parseCurve("ToneCurvePV2012Blue", in: text),
            crop: parseHasCrop(in: text) == false
                ? nil : cropRect { parseDouble("Crop\($0)", in: text) },
            cropAngle: parseHasCrop(in: text) == false
                ? 0 : parseDouble("CropAngle", in: text) ?? 0,
            rotation: rotation(fromXMP: parseOrientation(in: text), base: baseOrientation))
    }

    // tiff:Orientation stores the ABSOLUTE display orientation (Lightroom
    // mirrors the file's own orientation there even without a user turn), so
    // the model's additive rotation is the difference against the base.
    // Only the rotation subgroup 1/6/3/8 is handled; mirrored values pass
    // through as "no turn".
    private static let orientationDegrees = [1: 0, 6: 90, 3: 180, 8: 270]

    static func rotation(fromXMP xmp: Int?, base: Int) -> Int {
        guard let xmp, let xmpDegrees = orientationDegrees[xmp] else { return 0 }
        let baseDegrees = orientationDegrees[base] ?? 0
        return (xmpDegrees - baseDegrees + 360) % 360
    }

    static func absoluteOrientation(rotation: Int, base: Int) -> Int {
        let baseDegrees = orientationDegrees[base] ?? 0
        let total = (baseDegrees + rotation + 360) % 360
        return orientationDegrees.first { $0.value == total }?.key ?? 1
    }

    static func parseOrientation(in text: String) -> Int? {
        if let match = text.firstMatch(of: /tiff:Orientation\s*=\s*"([1368])"/) {
            return Int(match.1)
        }
        if let match = text.firstMatch(of: /<tiff:Orientation>\s*([1368])\s*<\/tiff:Orientation>/) {
            return Int(match.1)
        }
        return nil
    }

    /// Lightroom's crop-reset keeps the Crop* values and flips HasCrop to
    /// False, so HasCrop is authoritative when present. The values themselves
    /// are clamped and rejected when degenerate — they come from foreign
    /// files.
    private static func cropRect(_ value: (String) -> Double?) -> CropRect? {
        guard let left = value("Left"), let top = value("Top"),
            let right = value("Right"), let bottom = value("Bottom"),
            left.isFinite, top.isFinite, right.isFinite, bottom.isFinite
        else { return nil }
        let clamp = { (value: Double) in min(max(value, 0), 1) }
        let rect = CropRect(
            left: clamp(left), top: clamp(top), right: clamp(right), bottom: clamp(bottom))
        guard rect.right - rect.left > 0.001, rect.bottom - rect.top > 0.001 else { return nil }
        return rect
    }

    private static let crsNamespace = "http://ns.adobe.com/camera-raw-settings/1.0/"
    private static let tiffNamespace = "http://ns.adobe.com/tiff/1.0/"

    /// The file's own EXIF orientation (1 when unreadable), the baseline the
    /// absolute tiff:Orientation is compared against.
    static func baseOrientation(at url: URL) -> Int {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [String: Any],
            let value = properties[kCGImagePropertyOrientation as String] as? Int
        else { return 1 }
        return value
    }

    static func readEmbedded(at url: URL, isRaw: Bool) -> (rating: Int?, edit: Edit) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil)
        else { return (nil, .identity) }
        var rating: Int?
        var scalars: [String: Double] = [:]
        var curves: [String: [CurvePoint]] = [:]
        var hasCrop: Bool?
        var xmpOrientation: Int?
        CGImageMetadataEnumerateTagsUsingBlock(metadata, nil, nil) { _, tag in
            guard let name = CGImageMetadataTagCopyName(tag) as String? else { return true }
            let namespace = CGImageMetadataTagCopyNamespace(tag) as String?
            let value = CGImageMetadataTagCopyValue(tag)
            if name == "Rating" && namespace == "http://ns.adobe.com/xap/1.0/" {
                if let text = value as? String { rating = Int(text) }
                if let number = value as? Int { rating = number }
            }
            if name == "Orientation" && namespace == tiffNamespace {
                if let text = value as? String { xmpOrientation = Int(text) }
                if let number = value as? Int { xmpOrientation = number }
            }
            guard namespace == crsNamespace else { return true }
            if name.hasPrefix("ToneCurvePV2012") {
                curves[name] = curvePoints(fromMetadataValue: value)
            } else if name == "HasCrop" {
                if let text = value as? String { hasCrop = text.lowercased() == "true" }
                if let flag = value as? Bool { hasCrop = flag }
            } else if let text = value as? String, let number = Double(text), number.isFinite {
                scalars[name] = number
            } else if let number = value as? Double, number.isFinite {
                scalars[name] = number
            }
            return true
        }
        let edit = Edit(
            exposure: scalars["Exposure2012"] ?? 0,
            highlights: scalars["Highlights2012"] ?? 0,
            shadows: scalars["Shadows2012"] ?? 0,
            temperature: scalars[isRaw ? "Temperature" : "IncrementalTemperature"],
            tint: scalars[isRaw ? "Tint" : "IncrementalTint"],
            vibrance: scalars["Vibrance"] ?? 0,
            saturation: scalars["Saturation"] ?? 0,
            curveRGB: curves["ToneCurvePV2012"] ?? [],
            curveRed: curves["ToneCurvePV2012Red"] ?? [],
            curveGreen: curves["ToneCurvePV2012Green"] ?? [],
            curveBlue: curves["ToneCurvePV2012Blue"] ?? [],
            crop: hasCrop == false ? nil : cropRect { scalars["Crop\($0)"] },
            cropAngle: hasCrop == false ? 0 : scalars["CropAngle"] ?? 0,
            rotation: rotation(fromXMP: xmpOrientation, base: baseOrientation(at: url)))
        return (rating, edit)
    }

    private static func curvePoints(fromMetadataValue value: Any?) -> [CurvePoint] {
        guard let array = value as? [Any] else { return [] }
        return array.compactMap { item -> CurvePoint? in
            var text: String?
            if let string = item as? String {
                text = string
            } else if CFGetTypeID(item as CFTypeRef) == CGImageMetadataTagGetTypeID() {
                text = CGImageMetadataTagCopyValue(item as! CGImageMetadataTag) as? String
            }
            guard let pair = text?.split(separator: ","), pair.count == 2,
                let x = Double(pair[0].trimmingCharacters(in: .whitespaces)),
                let y = Double(pair[1].trimmingCharacters(in: .whitespaces))
            else { return nil }
            return CurvePoint(x: x / 255, y: y / 255)
        }
    }

    public static func readRating(file: ImageFile) -> Int {
        if file.usesSidecar {
            return readSidecarRating(at: sidecarURL(forImagePath: file.path)) ?? 0
        }
        return embeddedCached(for: file).rating ?? 0
    }

    public static func readEdit(file: ImageFile) -> Edit {
        if file.usesSidecar {
            guard
                let text = try? String(
                    contentsOf: sidecarURL(forImagePath: file.path), encoding: .utf8)
            else { return .identity }
            return parseEdit(
                text, isRaw: file.isRaw,
                baseOrientation: baseOrientation(at: URL(fileURLWithPath: file.path)))
        }
        return embeddedCached(for: file).edit
    }

    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var embeddedCache:
        [String: (mtime: Double, rating: Int?, edit: Edit)] = [:]

    private static func embeddedCached(for file: ImageFile) -> (rating: Int?, edit: Edit) {
        cacheLock.lock()
        if let cached = embeddedCache[file.path], cached.mtime == file.mtime {
            cacheLock.unlock()
            return (cached.rating, cached.edit)
        }
        cacheLock.unlock()

        let read = readEmbedded(at: URL(fileURLWithPath: file.path), isRaw: file.isRaw)
        cacheLock.lock()
        embeddedCache[file.path] = (file.mtime, read.rating, read.edit)
        cacheLock.unlock()
        return read
    }

    public static func writeRating(_ rating: Int, file: ImageFile, tool: ExifTool) throws {
        let tagArg = rating == 0 ? "-XMP:Rating=" : "-XMP:Rating=\(rating)"
        try write([tagArg], clearing: rating == 0, file: file, tool: tool)
    }

    public static func writeEdit(_ edit: Edit, file: ImageFile, tool: ExifTool) throws {
        var args: [String] = []
        // The 2012-era slider tags are XMP integers; exiftool silently drops
        // a "10.0" for them with only a warning, so integer tags must be
        // formatted as integers.
        func integerScalar(_ tag: String, _ value: Double) {
            args.append(value == 0 ? "-XMP-crs:\(tag)=" : "-XMP-crs:\(tag)=\(Int(value.rounded()))")
        }
        // Replacing a list tag needs repeated `=` args: the first replaces the
        // list, the rest add to it. `-TAG=` followed by `-TAG+=` looks
        // equivalent but appends to the EXISTING items — every write then
        // grows the sidecar until exiftool crawls.
        func curve(_ tag: String, _ points: [CurvePoint]) {
            guard !Curve.isIdentity(points) else {
                args.append("-XMP-crs:\(tag)=")
                return
            }
            for point in points {
                let x = Int((point.x * 255).rounded())
                let y = Int((point.y * 255).rounded())
                args.append("-XMP-crs:\(tag)=\(x), \(y)")
            }
        }
        args.append(
            edit.exposure == 0 ? "-XMP-crs:Exposure2012=" : "-XMP-crs:Exposure2012=\(edit.exposure)"
        )
        integerScalar("Highlights2012", edit.highlights)
        integerScalar("Shadows2012", edit.shadows)
        // exiftool's name for crs:Temperature is ColorTemperature.
        let temperatureTag = file.isRaw ? "ColorTemperature" : "IncrementalTemperature"
        let tintTag = file.isRaw ? "Tint" : "IncrementalTint"
        if let temperature = edit.temperature {
            args.append("-XMP-crs:\(temperatureTag)=\(Int(temperature.rounded()))")
        } else {
            args.append("-XMP-crs:\(temperatureTag)=")
        }
        if let tint = edit.tint {
            args.append("-XMP-crs:\(tintTag)=\(Int(tint.rounded()))")
        } else {
            args.append("-XMP-crs:\(tintTag)=")
        }
        integerScalar("Vibrance", edit.vibrance)
        integerScalar("Saturation", edit.saturation)
        // Swift's Double interpolation switches to exponent form below 1e-4,
        // which neither our sidecar parser nor Lightroom reads back.
        func plainDecimal(_ value: Double) -> String {
            var text = String(format: "%.6f", value)
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
            return text
        }
        for (tag, value) in [
            ("Left", edit.crop?.left), ("Top", edit.crop?.top),
            ("Right", edit.crop?.right), ("Bottom", edit.crop?.bottom),
        ] {
            args.append(
                value.map { "-XMP-crs:Crop\(tag)=\(plainDecimal($0))" }
                    ?? "-XMP-crs:Crop\(tag)=")
        }
        args.append(
            edit.cropAngle == 0
                ? "-XMP-crs:CropAngle=" : "-XMP-crs:CropAngle=\(plainDecimal(edit.cropAngle))")
        args.append(edit.hasCropComponent ? "-XMP-crs:HasCrop=True" : "-XMP-crs:HasCrop=")
        // Absolute display orientation, like Lightroom writes it. The `#`
        // suffix keeps exiftool in numeric mode for this tag.
        if edit.normalizedRotation == 0 {
            args.append("-XMP-tiff:Orientation=")
        } else {
            let absolute = absoluteOrientation(
                rotation: edit.normalizedRotation,
                base: baseOrientation(at: URL(fileURLWithPath: file.path)))
            args.append("-XMP-tiff:Orientation#=\(absolute)")
        }
        curve("ToneCurvePV2012", edit.curveRGB)
        curve("ToneCurvePV2012Red", edit.curveRed)
        curve("ToneCurvePV2012Green", edit.curveGreen)
        curve("ToneCurvePV2012Blue", edit.curveBlue)
        try write(args, clearing: edit.isIdentity, file: file, tool: tool)
    }

    private static func write(
        _ tagArgs: [String], clearing: Bool, file: ImageFile, tool: ExifTool
    ) throws {
        if file.usesSidecar {
            let sidecar = sidecarURL(forImagePath: file.path)
            if FileManager.default.fileExists(atPath: sidecar.path) {
                try tool.write(["-overwrite_original"] + tagArgs + [sidecar.path])
            } else if !clearing {
                do {
                    try tool.write(tagArgs + ["-o", sidecar.path])
                } catch {
                    guard FileManager.default.fileExists(atPath: sidecar.path) else { throw error }
                    try tool.write(["-overwrite_original"] + tagArgs + [sidecar.path])
                }
            }
        } else {
            try tool.write(["-overwrite_original"] + tagArgs + [file.path])
        }
    }
}
