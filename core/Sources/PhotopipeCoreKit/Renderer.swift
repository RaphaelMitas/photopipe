import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

public final class Renderer: @unchecked Sendable {
    public enum RenderError: Error {
        case unreadable(String)
        case encodeFailed
    }

    public struct MaskPick: Encodable, Sendable {
        public let png: Data
        public let point: Mask.Point
    }

    public struct Preview: Encodable, Sendable {
        public let cachePath: String
        public let unmasked: Bool
    }

    private let cache: CacheFolder
    private let masker: Masker
    private let maskModelArrives: @Sendable () -> Bool
    private let context = CIContext(options: [.cacheIntermediates: true])
    private let exportContext = CIContext(options: [.cacheIntermediates: false])
    private let jpegColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!
    private let curveColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!

    private static let pipelineVersion = 10

    public struct RawDefaults: Sendable {
        public let temperature: Double
        public let tint: Double
        public let denoise: Double
    }

    struct CachedFilter {
        let filter: CIRAWFilter
        let mtime: Double
        let orientedSizeBeforeScaling: CGSize
        let defaults: RawDefaults
        var lastUsed: Date
        let context = CIContext(options: [.cacheIntermediates: true])
    }

    private let lock = NSLock()
    private var filtersByPathAndSize: [String: CachedFilter] = [:]
    private(set) var rawDecodeCount = 0
    private var defaultsByPath: [String: (values: RawDefaults, mtime: Double)] = [:]
    private var supportsByCamera: [String: Bool] = [:]
    private var supportsByPath: [String: (supported: Bool, mtime: Double)] = [:]
    private var pixelStampsByPath: [String: (mtime: Double, size: Int64, stamp: String)] = [:]
    private let filterCapacity = 6

    public convenience init(cacheDir: URL) {
        self.init(
            cacheDir: cacheDir, segment: Masker.vision, maskModelArrives: TapToSegment.modelArrives)
    }

    init(
        cacheDir: URL, segment: @escaping Masker.Segment,
        maskModelArrives: @escaping @Sendable () -> Bool = { true }
    ) {
        cache = CacheFolder(dir: cacheDir, maxBytes: 2 * 1024 * 1024 * 1024)
        masker = Masker(cache: cache, segment: segment)
        self.maskModelArrives = maskModelArrives
        cache.pruneInBackground()
    }

    public static func defaultCacheDir() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/renders")
    }

    public func cachePath(
        for file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) -> URL {
        let region = viewport.map { "|\($0.left),\($0.top),\($0.right),\($0.bottom)" } ?? ""
        let decoder = resolvedTag(for: file, requested: decoderVersion)
        let masks = edit.masks.contains(where: \.changesPixels) ? "|m\(Masker.version)" : ""
        let key =
            "\(pixelStamp(of: file))|\(edit.cacheKey)|\(maxPixel)\(region)\(decoder)\(masks)|v\(Self.pipelineVersion)"
        return cache.url(forKey: key)
    }

    public func restamp(_ before: ImageFile, to after: ImageFile) {
        guard before.mtime != after.mtime || before.size != after.size else { return }
        lock.withLock {
            pixelStampsByPath[after.path] = (after.mtime, after.size, carriedStamp(of: before))
        }
    }

    private func pixelStamp(of file: ImageFile) -> String {
        lock.withLock { carriedStamp(of: file) }
    }

    private func carriedStamp(of file: ImageFile) -> String {
        if let carried = pixelStampsByPath[file.path], carried.mtime == file.mtime,
            carried.size == file.size
        {
            return carried.stamp
        }
        return "\(file.path)|\(file.mtime)|\(file.size)"
    }

    public func preview(
        file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> Preview {
        let (rendered, unmasked) = try maskedOrBare(edit) { edit in
            try render(
                file: file, edit: edit, maxPixel: maxPixel, viewport: viewport,
                decoderVersion: decoderVersion)
        }
        return Preview(cachePath: rendered.path, unmasked: unmasked)
    }

    private func maskedOrBare<Value>(_ edit: Edit, _ render: (Edit) throws -> Value) throws -> (
        Value, unmasked: Bool
    ) {
        guard edit.masks.contains(where: \.changesPixels) else { return (try render(edit), false) }
        if maskModelArrives(), let masked = try? render(edit) { return (masked, false) }
        var bare = edit
        bare.masks = []
        return (try render(bare), true)
    }

    public func render(
        file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> URL {
        guard maxPixel > 0 else { throw RenderError.encodeFailed }
        let dest = cachePath(
            for: file, edit: edit, maxPixel: maxPixel, viewport: viewport,
            decoderVersion: decoderVersion)
        return try cache.cachedFile(at: dest) { temp in
            let raw =
                try file.isRaw
                ? rawFilter(for: file, maxPixel: maxPixel, decoderVersion: decoderVersion) : nil
            let image = Self.fitted(
                try sourceImage(
                    for: file, raw: raw, edit: edit, maxPixel: maxPixel, viewport: viewport),
                longEdge: CGFloat(maxPixel))

            guard
                let jpeg = (raw?.context ?? context).jpegRepresentation(
                    of: image, colorSpace: jpegColorSpace,
                    options: [
                        kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85
                    ])
            else { throw RenderError.encodeFailed }
            try jpeg.write(to: temp)
        }
    }

    public func exportJPEG(
        file: ImageFile, edit: Edit, quality: Double, to destination: URL,
        longEdge: Int? = nil, decoderVersion: Int? = nil
    ) throws {
        if let longEdge, !(1...100_000).contains(longEdge) { throw RenderError.encodeFailed }
        let jpeg = try decodedOnce(
            file: file, edit: edit, decodeEdge: longEdge.map { $0 * 2 }, longEdge: longEdge,
            decoderVersion: decoderVersion
        ) { context, image in
            context.jpegRepresentation(
                of: image, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                options: [
                    kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality
                ])
        }
        let temp = destination.deletingLastPathComponent()
            .appendingPathComponent("\(FileActions.tempPrefix)\(UUID().uuidString).jpg")
        try jpeg.write(to: temp)
        do {
            try FileManager.default.moveItem(at: temp, to: destination)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
    }

    public func still(
        file: ImageFile, edit: Edit, longEdge: Int, viewport: CropRect? = nil
    ) throws -> (image: CGImage, unmasked: Bool) {
        guard longEdge > 0 else { throw RenderError.encodeFailed }
        return try maskedOrBare(edit) { edit in
            try decodedOnce(
                file: file, edit: edit, decodeEdge: longEdge, longEdge: longEdge, viewport: viewport
            ) { context, image in
                context.createCGImage(
                    image, from: image.extent, format: .RGBA8,
                    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
            }
        }
    }

    private func decodedOnce<Output>(
        file: ImageFile, edit: Edit, decodeEdge: Int?, longEdge: Int?, viewport: CropRect? = nil,
        decoderVersion: Int? = nil, draw: (CIContext, CIImage) -> Output?
    ) throws -> Output {
        let raw = try file.isRaw ? makeFilter(for: file, decoderVersion: decoderVersion) : nil
        var image = try sourceImage(
            for: file, raw: raw, edit: edit, maxPixel: decodeEdge, viewport: viewport)
        if let longEdge { image = Self.fitted(image, longEdge: CGFloat(longEdge)) }
        defer { exportContext.clearCaches() }
        guard let output = draw(exportContext, image) else { throw RenderError.encodeFailed }
        return output
    }

    public func maskOverlay(
        file: ImageFile, source: Mask.Source, points: [Mask.Point], inverted: Bool, edit: Edit,
        maxPixel: Int
    ) throws -> URL {
        let framing = Edit(crop: edit.crop, cropAngle: edit.cropAngle, rotation: edit.rotation)
        let key =
            "\(pixelStamp(of: file))|overlay|\(source.rawValue)|\(inverted)|\(framing.cacheKey)|\(maxPixel)\(points.cacheKey)|m\(Masker.version)"
        return try cache.cachedFile(at: cache.url(forKey: key, pathExtension: "png")) { temp in
            let matte = try matte(for: file, source: source, points: points, inverted: inverted)
            try overlayPNG(of: matte, framing: framing, maxPixel: maxPixel).write(to: temp)
        }
    }

    public func maskAt(
        file: ImageFile, edit: Edit, points: [Mask.Point], inverted: Bool, at framedSpot: CGPoint,
        include: Bool, maxPixel: Int
    ) throws -> MaskPick {
        let photo = try masker.brightPhoto(for: pixelStamp(of: file)) { try neutral(for: file) }
        let clicked = Self.unframed(framedSpot, of: photo, edit)
        func stored(_ fraction: CGFloat) -> Double {
            (Double(min(max(fraction, 0), 1)) * 10_000).rounded() / 10_000
        }
        let point = Mask.Point(x: stored(clicked.x), y: stored(clicked.y), include: include)
        let matte = try masker.found(in: photo, source: .click, points: points + [point])
        return MaskPick(
            png: try overlayPNG(
                of: inverted ? matte.applyingFilter("CIColorInvert") : matte, framing: edit,
                maxPixel: maxPixel),
            point: point)
    }

    private func overlayPNG(of matte: CIImage, framing: Edit, maxPixel: Int) throws -> Data {
        guard maxPixel > 0 else { throw RenderError.encodeFailed }
        let coverage = CIImage(color: .white).cropped(to: matte.extent)
            .applyingFilter("CIBlendWithRedMask", parameters: [kCIInputMaskImageKey: matte])
        guard
            let png = context.pngRepresentation(
                of: Self.fitted(
                    Self.framed(coverage, framing, viewport: nil), longEdge: CGFloat(maxPixel)),
                format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        else { throw RenderError.encodeFailed }
        return png
    }

    private func neutral(for file: ImageFile) throws -> CIImage {
        try sourceImage(
            for: file, raw: file.isRaw ? makeFilter(for: file) : nil, edit: .identity,
            maxPixel: Masker.inputLongEdge)
    }

    private func matte(
        for file: ImageFile, source: Mask.Source, points: [Mask.Point], inverted: Bool
    ) throws -> CIImage {
        let matte = try masker.matte(for: pixelStamp(of: file), source: source, points: points) {
            try neutral(for: file)
        }
        return inverted ? matte.applyingFilter("CIColorInvert") : matte
    }

    public func rawDefaults(for file: ImageFile, decoderVersion: Int? = nil) throws -> RawDefaults? {
        guard file.isRaw else { return nil }
        let key = Self.defaultsKey(path: file.path, decoderVersion: decoderVersion)
        if let cached = lock.withLock({ defaultsByPath[key] }), cached.mtime == file.mtime {
            return cached.values
        }
        return try makeFilter(for: file, decoderVersion: decoderVersion).defaults
    }

    private func sourceImage(
        for file: ImageFile, raw cached: CachedFilter?, edit: Edit, maxPixel: Int?,
        viewport: CropRect? = nil
    ) throws -> CIImage {
        var image: CIImage
        if let cached {
            let filter = cached.filter
            let output = lock.withLock {
                let scale = Self.sourceScale(
                    for: edit, orientedSize: cached.orientedSizeBeforeScaling, maxPixel: maxPixel,
                    viewport: viewport)
                filter.scaleFactor = scale
                filter.exposure = Float(edit.exposure)
                filter.neutralTemperature = Float(edit.temperature ?? cached.defaults.temperature)
                filter.neutralTint = Float(edit.tint ?? cached.defaults.tint)
                if filter.isLuminanceNoiseReductionSupported {
                    let denoise = edit.denoise.map { min(max($0, 0), 100) / 100 }
                    filter.luminanceNoiseReductionAmount = Float(denoise ?? cached.defaults.denoise)
                }
                return filter.outputImage
            }
            guard let output else { throw RenderError.unreadable(file.path) }
            image = output
        } else {
            guard
                let source = CGImageSourceCreateWithURL(
                    URL(fileURLWithPath: file.path) as CFURL, nil)
            else {
                throw RenderError.unreadable(file.path)
            }
            let base = CIImage(
                cgImageSource: source, index: 0, options: [.applyOrientationProperty: true])
            guard !base.extent.isEmpty else { throw RenderError.unreadable(file.path) }
            let scale = Self.sourceScale(
                for: edit, orientedSize: base.extent.size, maxPixel: maxPixel, viewport: viewport)
            image = Self.incremental(
                Self.fitted(base, longEdge: base.longEdge * CGFloat(scale)), edit)
        }
        for mask in edit.masks where mask.changesPixels {
            let local = mask.adjust.edit
            let matte = try matte(
                for: file, source: mask.source, points: mask.points, inverted: mask.inverted)
            image = graded(Self.incremental(image, local), local)
                .applyingFilter(
                    "CIBlendWithRedMask",
                    parameters: [
                        kCIInputBackgroundImageKey: image,
                        kCIInputMaskImageKey: Masker.stretched(matte, over: image.extent),
                    ]
                )
                .cropped(to: image.extent)
        }
        return Self.framed(graded(image, edit), edit, viewport: viewport)
    }

    private static func incremental(_ source: CIImage, _ edit: Edit) -> CIImage {
        var image = source
        if edit.exposure != 0 {
            image = image.applyingFilter(
                "CIExposureAdjust", parameters: ["inputEV": edit.exposure])
        }
        if edit.exposure > 0 {
            image = Presence.shoulder(image, afterExposure: edit.exposure)
        }
        let temperature = edit.temperature ?? 0
        let tint = edit.tint ?? 0
        if temperature != 0 || tint != 0 {
            let mired = 1e6 / 6500 + temperature / 100 * (1e6 / 4500 - 1e6 / 6500)
            image = image.applyingFilter(
                "CITemperatureAndTint",
                parameters: [
                    "inputNeutral": CIVector(x: 6500, y: 0),
                    "inputTargetNeutral": CIVector(x: 1e6 / mired, y: -tint),
                ])
        }
        return image
    }

    private func graded(_ source: CIImage, _ edit: Edit) -> CIImage {
        var image = source
        if edit.dehaze != 0 {
            image = Presence.dehaze(image, amount: edit.dehaze)
        }
        if edit.highlights != 0 || edit.shadows != 0 {
            image = Presence.tone(image, highlights: edit.highlights, shadows: edit.shadows)
        }
        if let lut = ToneLUT.samples(for: edit) {
            image = image.applyingFilter(
                "CIColorCurves",
                parameters: [
                    "inputCurvesData": lut.withUnsafeBufferPointer { Data(buffer: $0) },
                    "inputCurvesDomain": CIVector(x: 0, y: 1),
                    "inputColorSpace": curveColorSpace,
                ])
        }
        if edit.clarity != 0 {
            image = Presence.clarity(image, amount: edit.clarity)
        }
        if edit.texture != 0 {
            image = Presence.texture(image, amount: edit.texture)
        }
        if edit.vibrance != 0 || edit.saturation != 0 {
            image = Presence.chroma(image, vibrance: edit.vibrance, saturation: edit.saturation)
        }
        return image
    }

    private static func framed(_ source: CIImage, _ edit: Edit, viewport: CropRect?) -> CIImage {
        var image = source
        if let turn = turn(edit) {
            image = image.oriented(forExifOrientation: turn)
        }
        if edit.hasCropComponent {
            image = Self.applyCrop(edit, to: image)
        }
        if let viewport {
            image = Self.applyViewport(viewport, to: image)
        }
        return image
    }

    private static func turn(_ edit: Edit) -> Int32? {
        switch edit.normalizedRotation {
        case 90: 6
        case 180: 3
        case 270: 8
        default: nil
        }
    }

    static func unframed(_ point: CGPoint, of photo: CIImage, _ edit: Edit) -> CGPoint {
        var toFrame = CGAffineTransform.identity
        var frame = photo.extent
        if let turn = turn(edit) {
            toFrame = photo.orientationTransform(forExifOrientation: turn)
            frame = frame.applying(toFrame)
        }
        if edit.hasCropComponent, let crop = saneCrop(edit) {
            let rect = pixelRect(for: crop, in: frame)
            toFrame = toFrame.concatenating(straightening(edit, in: frame))
                .concatenating(.init(translationX: -rect.minX, y: -rect.minY))
            frame = CGRect(origin: .zero, size: rect.size)
        }
        let inPhoto = CGPoint(
            x: frame.minX + point.x * frame.width, y: frame.minY + (1 - point.y) * frame.height
        ).applying(toFrame.inverted())
        return CGPoint(
            x: (inPhoto.x - photo.extent.minX) / photo.extent.width,
            y: 1 - (inPhoto.y - photo.extent.minY) / photo.extent.height)
    }

    static func saneCrop(_ edit: Edit) -> CropRect? {
        guard edit.cropAngle.isFinite, abs(edit.cropAngle) <= XMP.scalarMagnitudeLimit else { return nil }
        return (edit.crop ?? .full).sanitized()
    }

    static func pixelRect(for crop: CropRect, in extent: CGRect) -> CGRect {
        let raw = CGRect(
            x: extent.minX + crop.left * extent.width,
            y: extent.minY + (1 - crop.bottom) * extent.height,
            width: crop.width * extent.width,
            height: crop.height * extent.height)
        return CGRect(
            x: raw.minX.rounded(.up), y: raw.minY.rounded(.up),
            width: max(raw.maxX.rounded(.down) - raw.minX.rounded(.up), 1),
            height: max(raw.maxY.rounded(.down) - raw.minY.rounded(.up), 1))
    }

    static func applyViewport(_ viewport: CropRect, to image: CIImage) -> CIImage {
        guard let sane = viewport.sanitized() else { return image }
        let rect = pixelRect(for: sane, in: image.extent)
        return image.cropped(to: rect)
            .transformed(by: .init(translationX: -rect.minX, y: -rect.minY))
    }

    static func applyCrop(_ edit: Edit, to image: CIImage) -> CIImage {
        let extent = image.extent
        guard let crop = saneCrop(edit) else { return image }
        let rect = pixelRect(for: crop, in: extent)
        var result = image
        if edit.cropAngle != 0 {
            result = Straighten.transformed(result, by: straightening(edit, in: extent))
        }
        return result.cropped(to: rect)
            .transformed(by: .init(translationX: -rect.minX, y: -rect.minY))
    }

    static func straightening(_ edit: Edit, in extent: CGRect) -> CGAffineTransform {
        let center = CGPoint(x: extent.midX, y: extent.midY)
        let angle = -edit.cropAngle * .pi / 180
        return CGAffineTransform(translationX: center.x, y: center.y)
            .rotated(by: angle)
            .translatedBy(x: -center.x, y: -center.y)
    }

    static func fitted(_ image: CIImage, longEdge: CGFloat) -> CIImage {
        let extent = image.extent
        let scale = longEdge / image.longEdge
        guard scale < 1 else { return image }
        let size = CGSize(
            width: max((extent.width * scale).rounded(), 1),
            height: max((extent.height * scale).rounded(), 1))
        let scaleY = size.height / extent.height
        return image.clampedToExtent()
            .transformed(by: .init(translationX: -extent.minX, y: -extent.minY))
            .applyingFilter(
                "CILanczosScaleTransform",
                parameters: [
                    kCIInputScaleKey: scaleY,
                    kCIInputAspectRatioKey: size.width / extent.width / scaleY,
                ]
            )
            .cropped(to: CGRect(origin: .zero, size: size))
    }

    static func sourceScale(
        for edit: Edit, orientedSize: CGSize, maxPixel: Int?, viewport: CropRect? = nil
    ) -> Float {
        guard let maxPixel, maxPixel > 0, let crop = saneCrop(edit) else { return 1 }
        let framed = framedSize(orientedSize, edit, crop: crop)
        let region = viewport?.sanitized() ?? .full
        let longEdge = max(framed.width * region.width, framed.height * region.height)
        guard longEdge > 0 else { return 1 }
        return Float(min(CGFloat(maxPixel) / longEdge, 1))
    }

    static func framedSize(_ orientedSize: CGSize, _ edit: Edit, crop: CropRect) -> CGSize {
        var width = orientedSize.width
        var height = orientedSize.height
        if edit.normalizedRotation == 90 || edit.normalizedRotation == 270 {
            swap(&width, &height)
        }
        return CGSize(width: width * crop.width, height: height * crop.height)
    }

    private func rawFilter(
        for file: ImageFile, maxPixel: Int, decoderVersion: Int?
    ) throws -> CachedFilter {
        let key = "\(file.path)|\(maxPixel)\(Self.decoderTag(decoderVersion))"
        let warm = lock.withLock { () -> CachedFilter? in
            guard let cached = filtersByPathAndSize[key], cached.mtime == file.mtime else {
                return nil
            }
            filtersByPathAndSize[key]?.lastUsed = Date()
            return cached
        }
        if let warm { return warm }

        let entry = try makeFilter(for: file, decoderVersion: decoderVersion)
        lock.withLock {
            rawDecodeCount += 1
            filtersByPathAndSize[key] = entry
            if filtersByPathAndSize.count > filterCapacity {
                let oldest = filtersByPathAndSize.min { $0.value.lastUsed < $1.value.lastUsed }
                if let oldest { filtersByPathAndSize.removeValue(forKey: oldest.key) }
            }
        }
        return entry
    }

    public func supports(file: ImageFile, major: Int) -> Bool {
        known(file: file, major: major) ?? false
    }

    public func known(file: ImageFile, major: Int) -> Bool? {
        guard file.isRaw else { return false }
        let pathKey = "\(file.path)|v\(major)"
        if let known = lock.withLock({ supportsByPath[pathKey] }), known.mtime == file.mtime {
            return known.supported
        }

        let url = URL(fileURLWithPath: file.path)
        let ext = file.ext.lowercased()
        let cacheKey =
            Self.cameraModel(of: url).map { "\($0)|\(ext)|v\(major)" }
            ?? "path:\(file.path)|v\(major)"
        let cachedForCamera = lock.withLock { () -> Bool? in
            guard let supported = supportsByCamera[cacheKey] else { return nil }
            supportsByPath[pathKey] = (supported, file.mtime)
            return supported
        }
        if let cachedForCamera { return cachedForCamera }

        let filter = CIRAWFilter(imageURL: url)
        let versions = filter?.supportedDecoderVersions ?? []
        let supported = versions.contains { version in
            Self.isVersion(version, major) && filter.map { Self.renders($0, with: version) } == true
        }
        let readable = versions.contains { $0.rawValue != "None" }
        guard readable else { return nil }
        lock.withLock {
            supportsByCamera[cacheKey] = supported
            supportsByPath[pathKey] = (supported, file.mtime)
        }
        return supported
    }

    static func cameraModel(of url: URL) -> String? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        else { return nil }
        return tiff[kCGImagePropertyTIFFModel] as? String
    }

    static func isVersion(_ version: CIRAWDecoderVersion, _ major: Int) -> Bool {
        version.rawValue == "\(major)" || version.rawValue.hasPrefix("\(major).")
    }

    static func resolveDecoder(
        requested: Int?, supported: [CIRAWDecoderVersion],
        renders: (CIRAWDecoderVersion) -> Bool = { _ in true }
    ) -> CIRAWDecoderVersion? {
        let match = requested.flatMap { requested in
            supported.first { $0.rawValue == "\(requested)" }
                ?? supported.first { isVersion($0, requested) }
        }
        let newestFirst = supported.reversed().filter { $0 != match }
        return ([match].compactMap { $0 } + newestFirst).first(where: renders)
    }

    private static func renders(_ filter: CIRAWFilter, with version: CIRAWDecoderVersion) -> Bool {
        filter.decoderVersion = version
        return filter.outputImage != nil
    }

    private func resolvedTag(for file: ImageFile, requested: Int?) -> String {
        guard let requested, supports(file: file, major: requested) else { return "" }
        return "|d\(requested)"
    }

    private static func decoderTag(_ version: Int?) -> String {
        "|d\(version.map(String.init) ?? "")"
    }

    private static func defaultsKey(path: String, decoderVersion: Int?) -> String {
        "\(path)\(decoderTag(decoderVersion))"
    }

    func makeFilter(for file: ImageFile, decoderVersion: Int? = nil) throws -> CachedFilter {
        guard let filter = CIRAWFilter(imageURL: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        if let version = Self.resolveDecoder(
            requested: decoderVersion, supported: filter.supportedDecoderVersions,
            renders: { Self.renders(filter, with: $0) })
        {
            filter.decoderVersion = version
        }
        let entry = CachedFilter(
            filter: filter, mtime: file.mtime,
            orientedSizeBeforeScaling: filter.outputImage?.extent.size ?? filter.nativeSize,
            defaults: RawDefaults(
                temperature: Double(filter.neutralTemperature),
                tint: Double(filter.neutralTint),
                denoise: Double(filter.luminanceNoiseReductionAmount)),
            lastUsed: Date())
        lock.withLock {
            defaultsByPath[Self.defaultsKey(path: file.path, decoderVersion: decoderVersion)] = (
                entry.defaults, file.mtime
            )
        }
        return entry
    }
}

extension CIImage {
    var longEdge: CGFloat { max(extent.width, extent.height) }
}
