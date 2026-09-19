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

    private struct Tags {
        let scalar: (String) -> Double?
        let curve: (String) -> [CurvePoint]
        let hasCrop: Bool?
    }

    private static func edit(from tags: Tags, isRaw: Bool, rotation: Int) -> Edit {
        // other tools write a straight curve as two points; ours is the empty one.
        // nan or inf would fail every JSON encode of the whole shoot's listing
        func curve(_ tag: String) -> [CurvePoint] {
            let points = tags.curve(tag).filter { $0.x.isFinite && $0.y.isFinite }
            return Curve.isIdentity(points) ? [] : points
        }
        return Edit(
            exposure: tags.scalar("Exposure2012") ?? 0,
            highlights: tags.scalar("Highlights2012") ?? 0,
            shadows: tags.scalar("Shadows2012") ?? 0,
            whites: tags.scalar("Whites2012") ?? 0,
            blacks: tags.scalar("Blacks2012") ?? 0,
            texture: tags.scalar("Texture") ?? 0,
            clarity: tags.scalar("Clarity2012") ?? 0,
            dehaze: tags.scalar("Dehaze") ?? 0,
            temperature: tags.scalar(isRaw ? "Temperature" : "IncrementalTemperature"),
            tint: tags.scalar(isRaw ? "Tint" : "IncrementalTint"),
            denoise: isRaw ? tags.scalar("LuminanceSmoothing") : nil,
            vibrance: tags.scalar("Vibrance") ?? 0,
            saturation: tags.scalar("Saturation") ?? 0,
            curveRGB: curve("ToneCurvePV2012"),
            curveRed: curve("ToneCurvePV2012Red"),
            curveGreen: curve("ToneCurvePV2012Green"),
            curveBlue: curve("ToneCurvePV2012Blue"),
            // Lightroom's crop reset keeps Crop* but sets HasCrop False, so HasCrop wins
            crop: tags.hasCrop == false ? nil : cropRect { tags.scalar("Crop\($0)") },
            cropAngle: tags.hasCrop == false ? 0 : tags.scalar("CropAngle") ?? 0,
            rotation: rotation)
    }

    static func parseEdit(_ text: String, isRaw: Bool, baseOrientation: Int = 1) -> Edit {
        edit(
            from: Tags(
                scalar: { parseDouble($0, in: text) },
                curve: { parseCurve($0, in: text) },
                hasCrop: parseHasCrop(in: text)),
            isRaw: isRaw,
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
        case embeddedWriteUnsupported(String)
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
        let edit = edit(
            from: Tags(
                scalar: { scalars[$0] },
                curve: { curves[$0] ?? [] },
                hasCrop: hasCrop),
            isRaw: isRaw,
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

    struct TagWrite: Equatable {
        enum Namespace: CaseIterable {
            case xmp, crs, tiff

            var prefix: String {
                switch self {
                case .xmp: "xmp"
                case .crs: "crs"
                case .tiff: "tiff"
                }
            }

            var uri: String {
                switch self {
                case .xmp: "http://ns.adobe.com/xap/1.0/"
                case .crs: crsNamespace
                case .tiff: "http://ns.adobe.com/tiff/1.0/"
                }
            }
        }

        enum Value: Equatable {
            case scalar(String)
            case list([String])
            case remove
        }

        let namespace: Namespace
        let name: String
        let value: Value

        init(_ namespace: Namespace, _ name: String, _ value: Value) {
            self.namespace = namespace
            self.name = name
            self.value = value
        }
    }

    static func exiftoolArgs(_ tags: [TagWrite], exifOrientationPin: Int? = nil) -> [String] {
        tags.flatMap { tag -> [String] in
            let isOrientation = tag.namespace == .tiff && tag.name == "Orientation"
            let group = tag.namespace == .xmp ? "XMP" : "XMP-\(tag.namespace.prefix)"
            // exiftool's name for crs:Temperature is ColorTemperature;
            // `#` keeps exiftool numeric for Orientation
            let name =
                tag.namespace == .crs && tag.name == "Temperature"
                ? "ColorTemperature" : isOrientation ? "Orientation#" : tag.name
            let target = "-\(group):\(name)="
            // repeated `=` replaces the list; `+=` appends to the EXISTING items,
            // growing the sidecar on every write until exiftool crawls
            let args =
                switch tag.value {
                case .remove: [target]
                case .scalar(let value): ["\(target)\(value)"]
                case .list(let items): items.map { "\(target)\($0)" }
                }
            guard isOrientation, let exifOrientationPin else { return args }
            return args + ["-IFD0:Orientation#=\(exifOrientationPin)"]
        }
    }

    static func ratingTags(_ rating: Int) -> [TagWrite] {
        [TagWrite(.xmp, "Rating", rating == 0 ? .remove : .scalar("\(rating)"))]
    }

    public static func writeRating(_ rating: Int, file: ImageFile, tool: ExifTool) throws {
        try write(ratingTags(rating), clearing: rating == 0, file: file, tool: tool)
    }

    public static func writeEdit(_ edit: Edit, file: ImageFile, tool: ExifTool) throws {
        let (tags, exifOrientationPin) = try editTags(edit, file: file)
        try write(
            tags, exifOrientationPin: exifOrientationPin, clearing: edit.isIdentity,
            file: file, tool: tool)
    }

    static func editTags(
        _ edit: Edit, file: ImageFile
    ) throws -> (tags: [TagWrite], exifOrientationPin: Int?) {
        var tags: [TagWrite] = []
        // exiftool drops a "10.0" for these integer tags with only a warning
        func integerScalar(_ tag: String, _ value: Double?) {
            tags.append(
                TagWrite(.crs, tag, value.map { .scalar("\(saneInt($0))") } ?? .remove))
        }
        func curve(_ tag: String, _ points: [CurvePoint]) {
            guard !Curve.isIdentity(points) else {
                tags.append(TagWrite(.crs, tag, .remove))
                return
            }
            // clamped to the unit square first: Int(1e30) traps
            let items = Curve.normalized(points).map { point in
                "\(Int((point.x * 255).rounded())), \(Int((point.y * 255).rounded()))"
            }
            tags.append(TagWrite(.crs, tag, .list(items)))
        }
        // Swift's Double interpolation switches to exponent form below 1e-4,
        // which Lightroom does not read back
        func plainDecimal(_ value: Double) -> String {
            var text = String(format: "%.6f", value)
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
            return text
        }
        func realScalar(_ tag: String, _ value: Double?) {
            tags.append(TagWrite(.crs, tag, value.map { .scalar(plainDecimal($0)) } ?? .remove))
        }
        func nonZero(_ value: Double) -> Double? { value == 0 ? nil : value }
        realScalar("Exposure2012", nonZero(edit.exposure))
        integerScalar("Highlights2012", nonZero(edit.highlights))
        integerScalar("Shadows2012", nonZero(edit.shadows))
        integerScalar("Whites2012", nonZero(edit.whites))
        integerScalar("Blacks2012", nonZero(edit.blacks))
        integerScalar("Texture", nonZero(edit.texture))
        integerScalar("Clarity2012", nonZero(edit.clarity))
        realScalar("Dehaze", nonZero(edit.dehaze))
        integerScalar(file.isRaw ? "Temperature" : "IncrementalTemperature", edit.temperature)
        integerScalar(file.isRaw ? "Tint" : "IncrementalTint", edit.tint)
        integerScalar("LuminanceSmoothing", file.isRaw ? edit.denoise : nil)
        integerScalar("Vibrance", nonZero(edit.vibrance))
        integerScalar("Saturation", nonZero(edit.saturation))
        realScalar("CropLeft", edit.crop?.left)
        realScalar("CropTop", edit.crop?.top)
        realScalar("CropRight", edit.crop?.right)
        realScalar("CropBottom", edit.crop?.bottom)
        realScalar("CropAngle", nonZero(edit.cropAngle))
        tags.append(TagWrite(.crs, "HasCrop", edit.hasCropComponent ? .scalar("True") : .remove))
        // Absolute, like Lightroom writes it.
        // An unreadable base can default to 1 only for sidecars: guessing one
        // for an embedded file would burn it into the photo's real EXIF.
        let fileURL = URL(fileURLWithPath: file.path)
        let base =
            baseOrientation(at: fileURL) ?? (file.usesSidecar ? 1 : nil)
        let currentXMP =
            file.usesSidecar
            ? (try? String(
                contentsOf: sidecarURL(forImagePath: file.path), encoding: .utf8))
                .flatMap { parseOrientation(in: $0) }
            : embeddedXMPOrientation(at: fileURL)
        var exifOrientationPin: Int?
        if edit.normalizedRotation == 0 {
            // another tool's XMP value can be the only record of its turn, so
            // only write the base back when clearing a turn of our own
            if let currentXMP, let base, currentXMP != base {
                tags.append(TagWrite(.tiff, "Orientation", .scalar("\(base)")))
            }
        } else {
            guard let base else {
                throw XMPError.unreadableOrientation(file.path)
            }
            let absolute = absoluteOrientation(
                rotation: edit.normalizedRotation, base: base)
            tags.append(TagWrite(.tiff, "Orientation", .scalar("\(absolute)")))
            if !file.usesSidecar {
                // ImageIO folds this XMP value into the next read's merged
                // orientation, reading the rotation back as zero. EXIF wins
                // that merge, so pin the base there.
                exifOrientationPin = base
            }
        }
        curve("ToneCurvePV2012", edit.curveRGB)
        curve("ToneCurvePV2012Red", edit.curveRed)
        curve("ToneCurvePV2012Green", edit.curveGreen)
        curve("ToneCurvePV2012Blue", edit.curveBlue)
        return (tags, exifOrientationPin)
    }

    private static func write(
        _ tags: [TagWrite], exifOrientationPin: Int? = nil, clearing: Bool, file: ImageFile,
        tool: ExifTool
    ) throws {
        #if os(macOS)
            try writeWithExifTool(
                exiftoolArgs(tags, exifOrientationPin: exifOrientationPin),
                clearing: clearing, file: file, tool: tool)
        #else
            guard file.usesSidecar else { throw XMPError.embeddedWriteUnsupported(file.path) }
            try XMPTextWriter.write(
                tags, to: sidecarURL(forImagePath: file.path), clearing: clearing)
        #endif
    }

    private static func writeWithExifTool(
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
