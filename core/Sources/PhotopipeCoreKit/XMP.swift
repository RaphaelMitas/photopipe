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
    // reach the edit model (they poison JSON encoding and CI geometry), and
    // finite-but-huge ones would trap the integer tag writes later. No real
    // crs value exceeds Kelvin range, so a generous magnitude cap is safe.
    private static let number = "([-+]?[\\d.]+(?:[eE][-+]?\\d+)?)"
    static let scalarMagnitudeLimit = 1e6

    private static func sane(_ parsed: Double?) -> Double? {
        guard let parsed, parsed.isFinite, abs(parsed) <= scalarMagnitudeLimit
        else { return nil }
        return parsed
    }

    // `Int(Double)` traps beyond Int.max; edits can arrive over IPC with
    // values the parsers never vetted.
    private static func saneInt(_ value: Double) -> Int {
        Int(min(max(value.rounded(), -scalarMagnitudeLimit), scalarMagnitudeLimit))
    }

    /// XMP tags appear as attributes (`crs:Tag="v"`) or elements
    /// (`<crs:Tag>v</crs:Tag>`) depending on the writer; capture either.
    private static func firstCapture(
        _ tag: String, ns: String = "crs", pattern: String, in text: String
    ) -> String? {
        let attribute = try? Regex("\(ns):\(tag)\\s*=\\s*\"\(pattern)\"")
        if let attribute, let match = text.firstMatch(of: attribute),
            let value = match[1].substring
        {
            return String(value)
        }
        let element = try? Regex("<\(ns):\(tag)>\\s*\(pattern)\\s*</\(ns):\(tag)>")
        if let element, let match = text.firstMatch(of: element),
            let value = match[1].substring
        {
            return String(value)
        }
        return nil
    }

    static func parseDouble(_ tag: String, in text: String) -> Double? {
        sane(firstCapture(tag, pattern: number, in: text).flatMap(Double.init))
    }

    static func parseHasCrop(in text: String) -> Bool? {
        firstCapture("HasCrop", pattern: "(\\w+)", in: text)
            .map { $0.lowercased() == "true" }
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
    // the model's additive rotation is the difference against the base. A
    // display rotation on top of any orientation only changes its degrees:
    // R(k)∘(R(r)∘M) = R(r+k)∘M, so a mirrored base keeps its mirror.
    // Values follow exiftool's "Mirror horizontal and rotate N CW" naming.
    private static let orientationParts: [Int: (mirrored: Bool, degrees: Int)] = [
        1: (false, 0), 6: (false, 90), 3: (false, 180), 8: (false, 270),
        2: (true, 0), 7: (true, 90), 4: (true, 180), 5: (true, 270),
    ]

    private static func orientationValue(mirrored: Bool, degrees: Int) -> Int {
        let normalized = ((degrees % 360) + 360) % 360
        return orientationParts.first {
            $0.value.mirrored == mirrored && $0.value.degrees == normalized
        }?.key ?? 1
    }

    static func rotation(fromXMP xmp: Int?, base: Int) -> Int {
        guard let xmp, let xmpParts = orientationParts[xmp],
            let baseParts = orientationParts[base],
            xmpParts.mirrored == baseParts.mirrored
        else { return 0 }
        return (xmpParts.degrees - baseParts.degrees + 360) % 360
    }

    static func absoluteOrientation(rotation: Int, base: Int) -> Int {
        let baseParts = orientationParts[base] ?? (false, 0)
        return orientationValue(
            mirrored: baseParts.mirrored, degrees: baseParts.degrees + rotation)
    }

    static func parseOrientation(in text: String) -> Int? {
        firstCapture("Orientation", ns: "tiff", pattern: "([1-8])", in: text)
            .flatMap(Int.init)
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
        // A straightened crop may run past the frame box over the rotated
        // photo's overhang; one frame beyond matches Renderer.applyCrop.
        let clamp = { (value: Double) in min(max(value, -1), 2) }
        let rect = CropRect(
            left: clamp(left), top: clamp(top), right: clamp(right), bottom: clamp(bottom))
        guard rect.right - rect.left > 0.001, rect.bottom - rect.top > 0.001 else { return nil }
        return rect
    }

    private static let crsNamespace = "http://ns.adobe.com/camera-raw-settings/1.0/"

    public enum XMPError: Error {
        case unreadableOrientation(String)
    }

    /// The file's own display orientation (nil when unreadable), the baseline
    /// the absolute tiff:Orientation is compared against.
    static func baseOrientation(at url: URL) -> Int? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [String: Any]
        else { return nil }
        // A readable file without an orientation tag is upright, not unknown.
        return properties[kCGImagePropertyOrientation as String] as? Int ?? 1
    }

    /// The XMP packet's own tiff:Orientation, read from the raw bytes.
    /// ImageIO's metadata API reconciles EXIF and XMP into one value, which
    /// hides exactly the difference the additive-rotation model needs.
    static func embeddedXMPOrientation(at url: URL) -> Int? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            return nil
        }
        // JPEGs get a real segment walk so a decoy packet in a comment or
        // the compressed stream cannot win, and the scan stops at the image
        // data instead of walking a whole file with no packet.
        if data.starts(with: [0xFF, 0xD8]) {
            return jpegXMPPacket(in: data).flatMap { parseOrientation(in: $0) }
        }
        // Other containers (HEIC, PNG, TIFF): delimiter scan over the head of
        // the file. Real packets are well under a megabyte; a crafted
        // delimiter pair must not become a giant String.
        let head = data.prefix(16 << 20)
        guard let start = head.range(of: Data("<x:xmpmeta".utf8)),
            let end = head.range(
                of: Data("</x:xmpmeta>".utf8), in: start.upperBound..<head.endIndex),
            end.upperBound - start.lowerBound <= 4 << 20
        else { return nil }
        let text = String(decoding: head[start.lowerBound..<end.upperBound], as: UTF8.self)
        return parseOrientation(in: text)
    }

    private static let jpegXMPHeader = Data("http://ns.adobe.com/xap/1.0/\0".utf8)

    private static func jpegXMPPacket(in data: Data) -> String? {
        var index = data.startIndex + 2
        while index + 4 <= data.endIndex {
            guard data[index] == 0xFF else { return nil }
            let marker = data[index + 1]
            if marker == 0xFF {
                index += 1
                continue
            }
            // SOS/EOI: metadata segments are over.
            if marker == 0xDA || marker == 0xD9 { return nil }
            if (0xD0...0xD7).contains(marker) || marker == 0x01 {
                index += 2
                continue
            }
            let length = Int(data[index + 2]) << 8 | Int(data[index + 3])
            guard length >= 2, index + 2 + length <= data.endIndex else { return nil }
            if marker == 0xE1 {
                let payload = data[(index + 4)..<(index + 2 + length)]
                if payload.starts(with: jpegXMPHeader) {
                    return String(
                        decoding: payload.dropFirst(jpegXMPHeader.count), as: UTF8.self)
                }
            }
            index += 2 + length
        }
        return nil
    }

    static func readEmbedded(at url: URL, isRaw: Bool) -> (rating: Int?, edit: Edit) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil)
        else { return (nil, .identity) }
        var rating: Int?
        var scalars: [String: Double] = [:]
        var curves: [String: [CurvePoint]] = [:]
        var hasCrop: Bool?
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
            } else if name == "HasCrop" {
                if let text = value as? String { hasCrop = text.lowercased() == "true" }
                if let flag = value as? Bool { hasCrop = flag }
            } else if let text = value as? String, let number = sane(Double(text)) {
                scalars[name] = number
            } else if let number = value as? Double, let checked = sane(number) {
                scalars[name] = checked
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
            rotation: rotation(
                fromXMP: embeddedXMPOrientation(at: url),
                base: baseOrientation(at: url) ?? 1))
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
                baseOrientation: baseOrientation(at: URL(fileURLWithPath: file.path)) ?? 1)
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
            args.append(value == 0 ? "-XMP-crs:\(tag)=" : "-XMP-crs:\(tag)=\(saneInt(value))")
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
            args.append("-XMP-crs:\(temperatureTag)=\(saneInt(temperature))")
        } else {
            args.append("-XMP-crs:\(temperatureTag)=")
        }
        if let tint = edit.tint {
            args.append("-XMP-crs:\(tintTag)=\(saneInt(tint))")
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
        // suffix keeps exiftool in numeric mode for this tag. A failed base
        // read must never produce a write: for sidecar files 1 is a safe
        // default (nothing in the original is touched), but for embedded
        // files a guessed base would be burned into the photo's real EXIF.
        let fileURL = URL(fileURLWithPath: file.path)
        let base =
            baseOrientation(at: fileURL) ?? (file.usesSidecar ? 1 : nil)
        let currentXMP =
            file.usesSidecar
            ? (try? String(
                contentsOf: sidecarURL(forImagePath: file.path), encoding: .utf8))
                .flatMap { parseOrientation(in: $0) }
            : embeddedXMPOrientation(at: fileURL)
        if edit.normalizedRotation == 0 {
            // No turn to record. Leave any existing tag alone — for a photo
            // rotated by another tool the XMP value can be the only record of
            // its orientation — and only write the base back when clearing a
            // turn of our own (tag present and disagreeing with the base).
            if let currentXMP, let base, currentXMP != base {
                args.append("-XMP-tiff:Orientation#=\(base)")
            }
        } else {
            guard let base else {
                throw XMPError.unreadableOrientation(file.path)
            }
            let absolute = absoluteOrientation(
                rotation: edit.normalizedRotation, base: base)
            args.append("-XMP-tiff:Orientation#=\(absolute)")
            if !file.usesSidecar {
                // Embedded formats: ImageIO folds the XMP value we just wrote
                // into the merged orientation of the NEXT read, which would
                // make base == absolute and the rotation read back as zero.
                // Real EXIF wins that merge, so pin the base there.
                args.append("-IFD0:Orientation#=\(base)")
            }
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
