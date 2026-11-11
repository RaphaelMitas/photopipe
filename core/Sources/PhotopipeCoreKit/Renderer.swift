import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Shared by the dispatcher's workers.
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
        /// The photo has masks that could not be cut, and was rendered without any.
        public let unmasked: Bool
    }

    private let cache: CacheFolder
    private let masker: Masker
    private let maskModelArrives: @Sendable () -> Bool
    private let context = CIContext(options: [.cacheIntermediates: true])
    // an export renders each photo once, so there is nothing to reuse
    private let exportContext = CIContext(options: [.cacheIntermediates: false])
    private let jpegColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!
    // CIColorCurves clips to this space, so it must be no narrower than the preview's
    private let curveColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!

    // bump when the pixels change for an unchanged key
    private static let pipelineVersion = 10

    /// None of these are zero, so a slider left alone has to reach for them.
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
        // a shared context gets ~55ms slower per distinct RAW 9 image it has drawn
        let context = CIContext(options: [.cacheIntermediates: true])
    }

    private let lock = NSLock()
    private var filtersByPathAndSize: [String: CachedFilter] = [:]
    private(set) var rawDecodeCount = 0
    private var defaultsByPath: [String: (values: RawDefaults, mtime: Double)] = [:]
    private var supportsByCamera: [String: Bool] = [:]
    private var supportsByPath: [String: (supported: Bool, mtime: Double)] = [:]
    private var pixelStampsByPath: [String: (mtime: Double, size: Int64, stamp: String)] = [:]
    // the loupe holds current, both neighbours and a zoom render at once
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

    /// Our metadata writes move mtime and size without touching a pixel, so what was rendered and cut still holds.
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

    /// What the loupe shows. A mask that cannot be cut costs the photo its masks, not the photo.
    public func preview(
        file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> Preview {
        func rendered(_ edit: Edit) throws -> String {
            try render(
                file: file, edit: edit, maxPixel: maxPixel, viewport: viewport,
                decoderVersion: decoderVersion
            ).path
        }
        guard edit.masks.contains(where: \.changesPixels) else {
            return Preview(cachePath: try rendered(edit), unmasked: false)
        }
        // asked first, so a model still downloading does not hold the render lane
        if maskModelArrives(), let masked = try? rendered(edit) {
            return Preview(cachePath: masked, unmasked: false)
        }
        var bare = edit
        bare.masks = []
        return Preview(cachePath: try rendered(bare), unmasked: true)
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
        // past any sensor, and doubling it must not overflow
        if let longEdge, !(1...100_000).contains(longEdge) { throw RenderError.encodeFailed }
        // an export is decoded once; caching it would evict the loupe's warm filters
        let raw = try file.isRaw ? makeFilter(for: file, decoderVersion: decoderVersion) : nil
        // decoding straight at the target comes out visibly soft
        var image = try sourceImage(
            for: file, raw: raw, edit: edit, maxPixel: longEdge.map { $0 * 2 })
        if let longEdge { image = Self.fitted(image, longEdge: CGFloat(longEdge)) }
        // An export render holds on to surfaces the context will happily
        // keep for the next one. Nothing else reuses them, and about a hundred
        // in they stop being handed out at all: every render after that comes
        // back nil while memory still looks fine.
        defer { exportContext.clearCaches() }
        guard
            let jpeg = exportContext.jpegRepresentation(
                of: image, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                options: [
                    kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption:
                        quality
                ])
        else { throw RenderError.encodeFailed }
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

    /// The mask as the alpha of a white image, framed like the render it lies over.
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

    /// Never cached: the cursor asks on every move.
    public func maskAt(
        file: ImageFile, edit: Edit, points: [Mask.Point], inverted: Bool, at framedSpot: CGPoint,
        include: Bool, maxPixel: Int
    ) throws -> MaskPick {
        let photo = try masker.brightPhoto(for: pixelStamp(of: file)) { try neutral(for: file) }
        let clicked = Self.unframed(framedSpot, of: photo, edit)
        // a ten-thousandth is a fifth of a pixel of what the model sees
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

    /// nil for non-raws, which have no neutral to offset against.
    public func rawDefaults(for file: ImageFile, decoderVersion: Int? = nil) throws -> RawDefaults? {
        guard file.isRaw else { return nil }
        let key = Self.defaultsKey(path: file.path, decoderVersion: decoderVersion)
        if let cached = lock.withLock({ defaultsByPath[key] }), cached.mtime == file.mtime {
            return cached.values
        }
        // reading these decodes nothing, so the filter is cheap and discarded
        return try makeFilter(for: file, decoderVersion: decoderVersion).defaults
    }

    /// A nil maxPixel renders the full sensor.
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
                // Unconditionally, even when unchanged: skipping the assignment
                // when it already matched returned a decode a quarter of the size
                // on the next read. Re-assigning does not cost the warm path.
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
            // CIImage(contentsOf:) segfaults on a JPEG whose header claims a huge frame
            guard
                let source = CGImageSourceCreateWithURL(
                    URL(fileURLWithPath: file.path) as CFURL, nil)
            else {
                throw RenderError.unreadable(file.path)
            }
            // the crop rect is against the displayed frame, not the sensor
            // layout, and the option drops the tag so nothing rotates twice
            let base = CIImage(
                cgImageSource: source, index: 0, options: [.applyOrientationProperty: true])
            guard !base.extent.isEmpty else { throw RenderError.unreadable(file.path) }
            let scale = Self.sourceScale(
                for: edit, orientedSize: base.extent.size, maxPixel: maxPixel, viewport: viewport)
            image = Self.incremental(
                Self.fitted(base, longEdge: base.longEdge * CGFloat(scale)), edit)
        }
        // after the photo's exposure and white balance, before its grade
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

    /// Exposure and white balance as filters: for files without a raw decoder, and for every mask's region.
    private static func incremental(_ source: CIImage, _ edit: Edit) -> CIImage {
        var image = source
        if edit.exposure != 0 {
            image = image.applyingFilter(
                "CIExposureAdjust", parameters: ["inputEV": edit.exposure])
        }
        // 2^EV alone runs highlights past 1, where they clip to cyan skies and flat white
        if edit.exposure > 0 {
            image = Presence.shoulder(image, afterExposure: edit.exposure)
        }
        let temperature = edit.temperature ?? 0
        let tint = edit.tint ?? 0
        if temperature != 0 || tint != 0 {
            // even mired steps look even, and a lower target neutral renders warmer,
            // like a raw's higher temperature
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

    /// Framed fraction to photo fraction, both from the top left.
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

    /// Normalized coordinates are top-left-origin; CI's are bottom-left.
    /// Rounds inward, or a straightened crop gets a thin blank edge.
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

    /// The sub-rect of the edited frame the loupe is actually showing. Not an
    /// edit: it never reaches a sidecar, and it composes on top of the crop.
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
        // pivot on center, matching the UI where the photo stays put
        let center = CGPoint(x: extent.midX, y: extent.midY)
        // CI is y-up, so on-screen-clockwise negates here; CSS gets it raw
        let angle = -edit.cropAngle * .pi / 180
        return CGAffineTransform(translationX: center.x, y: center.y)
            .rotated(by: angle)
            .translatedBy(x: -center.x, y: -center.y)
    }

    /// Clamped and whole pixels, or a part-transparent edge row blurs into a bright band.
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

    /// Decoding the full sensor and shrinking after costs RAW 9 three times as much.
    static func sourceScale(
        for edit: Edit, orientedSize: CGSize, maxPixel: Int?, viewport: CropRect? = nil
    ) -> Float {
        guard let maxPixel, maxPixel > 0, let crop = saneCrop(edit) else { return 1 }
        var width = orientedSize.width
        var height = orientedSize.height
        // the turn comes before the crop, so the fractions are against it
        if edit.normalizedRotation == 90 || edit.normalizedRotation == 270 {
            swap(&width, &height)
        }
        let region = viewport?.sanitized() ?? .full
        let longEdge = max(
            width * crop.width * region.width, height * crop.height * region.height)
        guard longEdge > 0 else { return 1 }
        return Float(min(CGFloat(maxPixel) / longEdge, 1))
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

    /// Support is a property of camera model plus OS, so one probe answers for
    /// every file from that camera.
    public func supports(file: ImageFile, major: Int) -> Bool {
        known(file: file, major: major) ?? false
    }

    /// nil when the file cannot be read yet, which is not the same answer as no.
    public func known(file: ImageFile, major: Int) -> Bool? {
        guard file.isRaw else { return false }
        // even the camera cache costs a header read, so a path answered once
        // never reads again
        let pathKey = "\(file.path)|v\(major)"
        if let known = lock.withLock({ supportsByPath[pathKey] }), known.mtime == file.mtime {
            return known.supported
        }

        let url = URL(fileURLWithPath: file.path)
        // resolveDecoder distinguishes the DNG variants, so a body's ARWs and
        // its DNG conversions cannot share one verdict
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
        // A file still being copied off a card names its camera in the header
        // but reports ["None"] here. That is "cannot read yet", not a verdict,
        // and caching it under the camera would answer for every sibling.
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

    /// `.version9` only exists in newer SDKs, but a build against an older one
    /// still meets RAW 9 at runtime on a newer macOS. The constants are just
    /// their version number ("9", "9.dng"), so match the value, not the symbol.
    static func isVersion(_ version: CIRAWDecoderVersion, _ major: Int) -> Bool {
        version.rawValue == "\(major)" || version.rawValue.hasPrefix("\(major).")
    }

    /// Setting a version the file does not offer makes outputImage nil, and so
    /// can one it offers: a 5D Mark IV CR2 on iOS offers 9 and renders nothing.
    static func resolveDecoder(
        requested: Int?, supported: [CIRAWDecoderVersion],
        renders: (CIRAWDecoderVersion) -> Bool = { _ in true }
    ) -> CIRAWDecoderVersion? {
        // supportedDecoderVersions is sorted oldest to newest
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

    /// A request the file cannot honour renders exactly what no request would,
    /// so it shares that key rather than naming a decoder that never ran. Keeps
    /// a Mac that later gains RAW 9 from serving the RAW 8 pixels it cached.
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
