import Foundation
import ImageIO

public enum XMP {
    public static func sidecarURL(forImagePath path: String) -> URL {
        URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("xmp")
    }

    /// 0 when there is no sidecar, which is also what the walk records — the
    /// two have to agree for a cached record to be recognised as still current.
    public static func sidecarMtime(forImagePath path: String) -> Double {
        let values = try? sidecarURL(forImagePath: path).resourceValues(
            forKeys: [.contentModificationDateKey])
        return values?.contentModificationDate?.timeIntervalSince1970 ?? 0
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

    // foreign sidecars carry exponents, and non-finite or huge values poison
    // JSON encoding, CI geometry and the integer tag writes downstream
    private static let number = "([-+]?[\\d.]+(?:[eE][-+]?\\d+)?)"
    static let scalarMagnitudeLimit = 1e6

    private static func sane(_ parsed: Double?) -> Double? {
        guard let parsed, parsed.isFinite, abs(parsed) <= scalarMagnitudeLimit
        else { return nil }
        return parsed
    }

    // `Int(Double)` traps beyond Int.max, and IPC edits skip the parsers
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
            denoise: isRaw ? parseDouble("LuminanceSmoothing", in: text) : nil,
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

    // tiff:Orientation is ABSOLUTE, so our additive rotation is its difference
    // against the base. R(k)∘(R(r)∘M) = R(r+k)∘M, so a mirrored base stays
    // mirrored. Naming follows exiftool's "Mirror horizontal and rotate N CW".
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
    /// False, so HasCrop wins when present.
    private static func cropRect(_ value: (String) -> Double?) -> CropRect? {
        guard let left = value("Left"), let top = value("Top"),
            let right = value("Right"), let bottom = value("Bottom"),
            left.isFinite, top.isFinite, right.isFinite, bottom.isFinite
        else { return nil }
        // straightened crops overhang the frame box; matches Renderer.saneCrop
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

    /// The baseline the absolute tiff:Orientation is compared against.
    static func baseOrientation(at url: URL) -> Int? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [String: Any]
        else { return nil }
        // A readable file without an orientation tag is upright, not unknown.
        return properties[kCGImagePropertyOrientation as String] as? Int ?? 1
    }

    /// Read from raw bytes: ImageIO reconciles EXIF and XMP into one value,
    /// hiding exactly the difference the additive-rotation model needs.
    static func embeddedXMPOrientation(at url: URL) -> Int? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            return nil
        }
        // a segment walk, so a decoy packet in a comment cannot win
        if data.starts(with: [0xFF, 0xD8]) {
            return jpegXMPPacket(in: data).flatMap { parseOrientation(in: $0) }
        }
        // HEIC, PNG, TIFF: a crafted delimiter pair must not become a giant String
        let head = data.prefix(16 << 20)
        guard let start = head.range(of: Data("<x:xmpmeta".utf8)),
            let end = head.range(
                of: Data("</x:xmpmeta>".utf8), in: start.upperBound..<head.endIndex),
            end.upperBound - start.lowerBound <= 4 << 20
        else { return nil }
        let text = String(decoding: head[start.lowerBound..<end.upperBound], as: UTF8.self)
        return parseOrientation(in: text)
    }

    private static let jpegPacketHeader = Data("http://ns.adobe.com/xap/1.0/\0".utf8)

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
                if payload.starts(with: jpegPacketHeader) {
                    return String(
                        decoding: payload.dropFirst(jpegPacketHeader.count), as: UTF8.self)
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
            denoise: isRaw ? scalars["LuminanceSmoothing"] : nil,
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

    private static let xmpNamespace = "http://ns.adobe.com/xap/1.0/"
    private static let tiffNamespace = "http://ns.adobe.com/tiff/1.0/"

    private static func crs(_ name: String, _ value: XMPTagOp.Value) -> XMPTagOp {
        XMPTagOp(namespace: crsNamespace, prefix: "crs", name: name, value: value)
    }

    private static func orientationOp(_ value: Int) -> XMPTagOp {
        XMPTagOp(
            namespace: tiffNamespace, prefix: "tiff", name: "Orientation",
            value: .scalar("\(value)"))
    }

    static func ratingOp(_ rating: Int) -> XMPTagOp {
        XMPTagOp(
            namespace: xmpNamespace, prefix: "xmp", name: "Rating",
            value: rating == 0 ? .clear : .scalar("\(rating)"))
    }

    public static func writeRating(_ rating: Int, file: ImageFile) throws {
        try PathLock.withLock(file.path) {
            try write([ratingOp(rating)], clearing: rating == 0, file: file)
        }
    }

    /// A JPEG we exported ourselves carries the rating embedded, whatever the
    /// source format used.
    public static func writeExportedRating(_ rating: Int, jpeg url: URL) throws {
        try XMPWriter.applyToEmbedded([ratingOp(rating)], url: url)
    }

    public static func writeEdit(_ edit: Edit, file: ImageFile) throws {
        try PathLock.withLock(file.path) { try applyEdit(edit, file: file) }
    }

    private static func applyEdit(_ edit: Edit, file: ImageFile) throws {
        var ops: [XMPTagOp] = []
        // Lightroom writes these as integers, and its reader is the target.
        func integerScalar(_ tag: String, _ value: Double) {
            ops.append(crs(tag, value == 0 ? .clear : .scalar("\(saneInt(value))")))
        }
        func curve(_ tag: String, _ points: [CurvePoint]) {
            guard !Curve.isIdentity(points) else {
                ops.append(crs(tag, .clear))
                return
            }
            let items = points.map { point in
                "\(Int((point.x * 255).rounded())), \(Int((point.y * 255).rounded()))"
            }
            ops.append(crs(tag, .orderedList(items)))
        }
        ops.append(
            crs("Exposure2012", edit.exposure == 0 ? .clear : .scalar("\(edit.exposure)")))
        integerScalar("Highlights2012", edit.highlights)
        integerScalar("Shadows2012", edit.shadows)
        let temperatureTag = file.isRaw ? "Temperature" : "IncrementalTemperature"
        let tintTag = file.isRaw ? "Tint" : "IncrementalTint"
        ops.append(
            crs(temperatureTag, edit.temperature.map { .scalar("\(saneInt($0))") } ?? .clear))
        ops.append(crs(tintTag, edit.tint.map { .scalar("\(saneInt($0))") } ?? .clear))
        if let denoise = edit.denoise, file.isRaw {
            ops.append(crs("LuminanceSmoothing", .scalar("\(saneInt(denoise))")))
        } else {
            ops.append(crs("LuminanceSmoothing", .clear))
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
            ops.append(crs("Crop\(tag)", value.map { .scalar(plainDecimal($0)) } ?? .clear))
        }
        ops.append(
            crs(
                "CropAngle",
                edit.cropAngle == 0 ? .clear : .scalar(plainDecimal(edit.cropAngle))))
        ops.append(crs("HasCrop", edit.hasCropComponent ? .scalar("True") : .clear))
        // Absolute, like Lightroom writes it. An unreadable base can default
        // to 1 only for sidecars: guessing one for an embedded file would
        // burn it into the photo's real EXIF.
        let fileURL = URL(fileURLWithPath: file.path)
        let base =
            baseOrientation(at: fileURL) ?? (file.usesSidecar ? 1 : nil)
        let currentXMP =
            file.usesSidecar
            ? (try? String(
                contentsOf: sidecarURL(forImagePath: file.path), encoding: .utf8))
                .flatMap { parseOrientation(in: $0) }
            : embeddedXMPOrientation(at: fileURL)
        var pinnedEXIFOrientation: Int?
        if edit.normalizedRotation == 0 {
            // another tool's XMP value can be the only record of its turn, so
            // only write the base back when clearing a turn of our own
            if let currentXMP, let base, currentXMP != base {
                ops.append(orientationOp(base))
            }
        } else {
            guard let base else {
                throw XMPError.unreadableOrientation(file.path)
            }
            let absolute = absoluteOrientation(
                rotation: edit.normalizedRotation, base: base)
            ops.append(orientationOp(absolute))
            if !file.usesSidecar {
                // ImageIO folds this XMP value into the next read's merged
                // orientation, reading the rotation back as zero. EXIF wins
                // that merge, so pin the base there.
                pinnedEXIFOrientation = base
            }
        }
        curve("ToneCurvePV2012", edit.curveRGB)
        curve("ToneCurvePV2012Red", edit.curveRed)
        curve("ToneCurvePV2012Green", edit.curveGreen)
        curve("ToneCurvePV2012Blue", edit.curveBlue)
        try write(
            ops, clearing: edit.isIdentity, file: file,
            exifOrientation: pinnedEXIFOrientation)
    }

    private static func write(
        _ ops: [XMPTagOp], clearing: Bool, file: ImageFile, exifOrientation: Int? = nil
    ) throws {
        if file.usesSidecar {
            let sidecar = sidecarURL(forImagePath: file.path)
            // Nothing to clear when there is no sidecar; don't create one
            // just to hold an identity edit.
            if !FileManager.default.fileExists(atPath: sidecar.path) && clearing { return }
            try XMPWriter.applyToSidecar(ops, sidecar: sidecar)
        } else {
            let url = URL(fileURLWithPath: file.path)
            var ops = ops
            var pin = exifOrientation
            // A stored turn lives as an absolute XMP value against a pinned
            // EXIF base. The metadata merge re-syncs XMP from EXIF, so a write
            // that says nothing about orientation — a rating, say — would
            // silently undo the turn. Carry the pair through untouched.
            if pin == nil,
                !ops.contains(where: { $0.prefix == "tiff" && $0.name == "Orientation" }),
                let currentXMP = embeddedXMPOrientation(at: url),
                let base = baseOrientation(at: url), currentXMP != base
            {
                ops.append(orientationOp(currentXMP))
                pin = base
            }
            try XMPWriter.applyToEmbedded(ops, url: url, exifOrientation: pin)
        }
    }
}
