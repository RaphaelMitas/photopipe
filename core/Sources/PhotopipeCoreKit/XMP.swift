import Foundation
import ImageIO

public enum XMP {
    /// Keeps the extension so a RAW+JPEG pair's JPEG cannot take the ARW's DSC0001.xmp,
    /// and adds .photopipe because darktable and digiKam already own DSC0001.JPG.xmp.
    public static func sidecarURL(forImagePath path: String) -> URL {
        let url = URL(fileURLWithPath: path)
        return sidecarOnlyExtensions.contains(url.pathExtension.lowercased())
            ? url.deletingPathExtension().appendingPathExtension("xmp")
            : url.appendingPathExtension("photopipe.xmp")
    }

    /// Empty is absent, as for exiftool, and a symlink would lend a read another file's rating.
    static func isOwnSidecar(_ sidecar: URL) throws -> Bool {
        do {
            let values = try sidecar.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            return values.isRegularFile == true && (values.fileSize ?? 0) > 0
        } catch let error as CocoaError
            where [.fileReadNoSuchFile, .fileReadInvalidFileName].contains(error.code)
        {
            // a name at the length limit has no room for .photopipe.xmp, so it never has one
            return false
        }
    }

    /// 0 when there is no sidecar, which is also what the walk records — the
    /// two have to agree for a cached record to be recognised as still current.
    public static func sidecarMtime(forImagePath path: String) -> Double {
        let values = try? sidecarURL(forImagePath: path).resourceValues(
            forKeys: [.contentModificationDateKey])
        return values?.contentModificationDate?.timeIntervalSince1970 ?? 0
    }

    // the tag parser costs ~70x the packet in memory
    static let packetSizeLimit = 4 << 20

    // Lightroom brush masks push real sidecars well past the embedded cap
    static let sidecarSizeLimit = 64 << 20

    static func sidecarData(forImagePath path: String) -> Data? {
        let sidecar = sidecarURL(forImagePath: path)
        guard (try? isOwnSidecar(sidecar)) == true, let handle = try? FileHandle(forReadingFrom: sidecar),
            let data = try? handle.read(upToCount: sidecarSizeLimit + 1),
            data.count <= sidecarSizeLimit
        else { return nil }
        return data
    }

    // non-finite or huge values poison JSON encoding, CI geometry and the
    // integer tag writes downstream
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

    private static func curvePoint(_ text: String) -> CurvePoint? {
        let pair = text.split(separator: ",")
        guard pair.count == 2,
            let x = Double(pair[0].trimmingCharacters(in: .whitespaces)),
            let y = Double(pair[1].trimmingCharacters(in: .whitespaces))
        else { return nil }
        return CurvePoint(x: x / 255, y: y / 255)
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

    typealias Judgment = (rating: Int?, flag: Int?, edit: Edit)

    private static func int(_ text: String?, in range: ClosedRange<Int>) -> Int? {
        text.flatMap { Int($0) }.flatMap { range.contains($0) ? $0 : nil }
    }

    // Bridge writes its reject as Rating -1; the reject here is the pick flag, so that reads as unrated
    private static func validRating(_ text: String?) -> Int? { int(text, in: 0...5) }

    private static func validFlag(_ text: String?) -> Int? { int(text, in: -1...1) }

    static func parse(
        _ packet: some Collection<UInt8>, isRaw: Bool, baseOrientation: Int = 1
    ) -> Judgment {
        let properties = XMPProperties(packet)
        let edit = edit(
            from: Tags(
                scalar: { sane(properties.value(.crs, $0).flatMap(Double.init)) },
                curve: { properties.items(.crs, $0).compactMap(curvePoint) },
                hasCrop: properties.value(.crs, "HasCrop").map { $0.lowercased() == "true" }),
            isRaw: isRaw,
            rotation: rotation(fromXMP: orientation(in: properties), base: baseOrientation))
        return (
            validRating(properties.value(.xmp, "Rating")), validFlag(properties.value(.xmpDM, "pick")), edit
        )
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

    static func orientation(in properties: XMPProperties) -> Int? {
        guard let value = properties.value(.tiff, "Orientation").flatMap({ Int($0) }),
            orientationParts[value] != nil
        else { return nil }
        return value
    }

    private static func cropRect(_ value: (String) -> Double?) -> CropRect? {
        guard let left = value("Left"), let top = value("Top"),
            let right = value("Right"), let bottom = value("Bottom"),
            let rect = CropRect(left: left, top: top, right: right, bottom: bottom).sanitized(),
            rect.width > 0.001, rect.height > 0.001
        else { return nil }
        return rect
    }

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
        // off the boot volume a mapping reads the whole file, a multi-GB TIFF scan included
        guard let handle = try? FileHandle(forReadingFrom: url),
            let head = try? handle.read(upToCount: 16 << 20)
        else { return nil }
        // a segment walk, so a decoy packet in a comment cannot win
        if head.starts(with: [0xFF, 0xD8]) {
            return jpegXMPPacket(in: head).flatMap { orientation(in: XMPProperties($0)) }
        }
        // anything else: a crafted delimiter pair must not become a giant String
        guard let start = head.range(of: Data("<x:xmpmeta".utf8)),
            let end = head.range(
                of: Data("</x:xmpmeta>".utf8), in: start.upperBound..<head.endIndex),
            end.upperBound - start.lowerBound <= packetSizeLimit
        else { return nil }
        return orientation(in: XMPProperties(head[start.lowerBound..<end.upperBound]))
    }

    private static let jpegPacketHeader = Data("http://ns.adobe.com/xap/1.0/\0".utf8)

    private static func jpegXMPPacket(in data: Data) -> Data? {
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
                    return payload.dropFirst(jpegPacketHeader.count)
                }
            }
            index += 2 + length
        }
        return nil
    }

    static func embedded(_ file: ImageFile) -> Judgment {
        let url = URL(fileURLWithPath: file.path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil)
        else { return (nil, nil, .identity) }
        let rating = validRating(
            CGImageMetadataCopyStringValueWithPath(metadata, nil, "xmp:Rating" as CFString)
                as String?)
        // a sidecar-only raw is never written into, so its XMP holds just what the camera put there
        guard !file.sidecarOnly else { return (rating, nil, .identity) }
        var pick: Int?
        var scalars: [String: Double] = [:]
        var curves: [String: [CurvePoint]] = [:]
        var hasCrop: Bool?
        CGImageMetadataEnumerateTagsUsingBlock(metadata, nil, nil) { _, tag in
            guard let name = CGImageMetadataTagCopyName(tag) as String? else { return true }
            let namespace = CGImageMetadataTagCopyNamespace(tag) as String?
            let value = CGImageMetadataTagCopyValue(tag)
            if namespace == TagWrite.Namespace.xmpDM.uri && name == "pick" {
                pick = validFlag(value as? String)
            }
            guard namespace == TagWrite.Namespace.crs.uri else { return true }
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
            isRaw: file.isRaw,
            rotation: rotation(
                fromXMP: embeddedXMPOrientation(at: url),
                base: baseOrientation(at: url) ?? 1))
        return (rating, pick, edit)
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
            return text.flatMap(curvePoint)
        }
    }

    public static func read(file: ImageFile) -> (rating: Int, flag: Int, edit: Edit) {
        let fileURL = URL(fileURLWithPath: file.path)
        let read: Judgment
        if (try? isOwnSidecar(sidecarURL(forImagePath: file.path))) == true {
            read =
                sidecarData(forImagePath: file.path).map {
                    parse($0, isRaw: file.isRaw, baseOrientation: baseOrientation(at: fileURL) ?? 1)
                } ?? (nil, nil, .identity)
        } else {
            read = embedded(file)
        }
        return (read.rating ?? 0, read.flag ?? 0, read.edit)
    }

    struct TagWrite {
        enum Namespace: String, CaseIterable {
            case xmp, crs, tiff, xmpDM

            var prefix: String { rawValue }

            var uri: String {
                switch self {
                case .xmp: "http://ns.adobe.com/xap/1.0/"
                case .crs: "http://ns.adobe.com/camera-raw-settings/1.0/"
                case .tiff: "http://ns.adobe.com/tiff/1.0/"
                case .xmpDM: "http://ns.adobe.com/xmp/1.0/DynamicMedia/"
                }
            }
        }

        enum Value {
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
            let args =
                switch tag.value {
                case .remove: [target]
                case .scalar(let value): ["\(target)\(value)"]
                // repeated `=` replaces the list; `+=` would append to the existing items on every write
                case .list(let items): items.map { "\(target)\($0)" }
                }
            guard isOrientation, let exifOrientationPin else { return args }
            return args + ["-IFD0:Orientation#=\(exifOrientationPin)"]
        }
    }

    static func ratingTags(_ rating: Int) -> [TagWrite] {
        [TagWrite(.xmp, "Rating", rating == 0 ? .remove : .scalar("\(rating)"))]
    }

    public static func writeRating(_ rating: Int, file: ImageFile) throws {
        try write(ratingTags(rating), clearing: rating == 0, file: file)
    }

    // where Lightroom Classic 13.2 and later keeps its flag
    static func flagTags(_ flag: Int) -> [TagWrite] {
        [TagWrite(.xmpDM, "pick", flag == 0 ? .remove : .scalar("\(flag)"))]
    }

    public static func writeFlag(_ flag: Int, file: ImageFile) throws {
        try write(flagTags(flag), clearing: flag == 0, file: file)
    }

    public static func writeEdit(_ edit: Edit, file: ImageFile) throws {
        let (tags, exifOrientationPin) = try editTags(edit, file: file)
        try write(
            tags, exifOrientationPin: exifOrientationPin, clearing: edit.isIdentity, file: file)
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
        // An unreadable base can default to 1 only for sidecars: guessing one
        // for an embedded file would burn it into the photo's real EXIF.
        let fileURL = URL(fileURLWithPath: file.path)
        // a sidecar-only raw records there even before one exists; anything else shows its own XMP till then
        let inSidecar = try file.sidecarOnly || isOwnSidecar(sidecarURL(forImagePath: file.path))
        let base =
            baseOrientation(at: fileURL) ?? (inSidecar ? 1 : nil)
        let currentXMP =
            inSidecar
            ? sidecarData(forImagePath: file.path).flatMap { orientation(in: XMPProperties($0)) }
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
            if !inSidecar {
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

    // serialized, so two writes can neither both seed a new sidecar nor lose each other's tags
    private static let writeLock = NSLock()

    private static func write(
        _ tags: [TagWrite], exifOrientationPin: Int? = nil, clearing: Bool, file: ImageFile
    ) throws {
        try writeLock.withLock {
            #if os(macOS)
                let sidecar = sidecarURL(forImagePath: file.path)
                let target =
                    try isOwnSidecar(sidecar)
                    ? sidecar : file.embedsXMP ? URL(fileURLWithPath: file.path) : nil
                if let target {
                    return try ExifTool.shared.write(
                        ["-overwrite_original"]
                            + exiftoolArgs(tags, exifOrientationPin: exifOrientationPin)
                            + [target.path])
                }
            #endif
            try writeText(tags, clearing: clearing, file: file)
        }
    }

    static func writeText(_ tags: [TagWrite], clearing: Bool, file: ImageFile) throws {
        try XMPTextWriter.write(
            tags, to: sidecarURL(forImagePath: file.path), clearing: clearing,
            seed: { try embeddedTags(file) })
    }

    /// `read` stops looking inside the file once a sidecar exists, so the sidecar starts
    /// with the rating, flag and edit the file carried.
    static func embeddedTags(_ file: ImageFile) throws -> [TagWrite] {
        let (rating, flag, edit) = embedded(file)
        guard (rating ?? 0) != 0 || (flag ?? 0) != 0 || !edit.isIdentity else { return [] }
        return try ratingTags(rating ?? 0) + flagTags(flag ?? 0) + editTags(edit, file: file).tags
    }
}
