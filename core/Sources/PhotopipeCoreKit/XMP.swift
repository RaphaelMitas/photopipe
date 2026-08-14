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

    static func parseDouble(_ tag: String, in text: String) -> Double? {
        let attribute = try? Regex("crs:\(tag)\\s*=\\s*\"([-+]?[\\d.]+)\"")
        if let attribute, let match = text.firstMatch(of: attribute),
            let value = match[1].substring
        {
            return Double(value)
        }
        let element = try? Regex("<crs:\(tag)>\\s*([-+]?[\\d.]+)\\s*</crs:\(tag)>")
        if let element, let match = text.firstMatch(of: element),
            let value = match[1].substring
        {
            return Double(value)
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

    static func parseEdit(_ text: String, isRaw: Bool) -> Edit {
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
            crop: cropRect { parseDouble("Crop\($0)", in: text) },
            cropAngle: parseDouble("CropAngle", in: text) ?? 0)
    }

    private static func cropRect(_ value: (String) -> Double?) -> CropRect? {
        guard let left = value("Left"), let top = value("Top"),
            let right = value("Right"), let bottom = value("Bottom")
        else { return nil }
        return CropRect(left: left, top: top, right: right, bottom: bottom)
    }

    private static let crsNamespace = "http://ns.adobe.com/camera-raw-settings/1.0/"

    static func readEmbedded(at url: URL, isRaw: Bool) -> (rating: Int?, edit: Edit) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil)
        else { return (nil, .identity) }
        var rating: Int?
        var scalars: [String: Double] = [:]
        var curves: [String: [CurvePoint]] = [:]
        CGImageMetadataEnumerateTagsUsingBlock(metadata, nil, nil) { _, tag in
            guard let name = CGImageMetadataTagCopyName(tag) as String? else { return true }
            let namespace = CGImageMetadataTagCopyNamespace(tag) as String?
            let value = CGImageMetadataTagCopyValue(tag)
            if name == "Rating" && namespace == "http://ns.adobe.com/xap/1.0/" {
                if let text = value as? String { rating = Int(text) }
                if let number = value as? Int { rating = number }
            }
            guard namespace == crsNamespace else { return true }
            if name.hasPrefix("ToneCurvePV2012") {
                curves[name] = curvePoints(fromMetadataValue: value)
            } else if let text = value as? String, let number = Double(text) {
                scalars[name] = number
            } else if let number = value as? Double {
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
            crop: cropRect { scalars["Crop\($0)"] },
            cropAngle: scalars["CropAngle"] ?? 0)
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
            return parseEdit(text, isRaw: file.isRaw)
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
        for (tag, value) in [
            ("Left", edit.crop?.left), ("Top", edit.crop?.top),
            ("Right", edit.crop?.right), ("Bottom", edit.crop?.bottom),
        ] {
            args.append(value.map { "-XMP-crs:Crop\(tag)=\($0)" } ?? "-XMP-crs:Crop\(tag)=")
        }
        args.append(edit.cropAngle == 0 ? "-XMP-crs:CropAngle=" : "-XMP-crs:CropAngle=\(edit.cropAngle)")
        args.append(edit.hasCropComponent ? "-XMP-crs:HasCrop=True" : "-XMP-crs:HasCrop=")
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
