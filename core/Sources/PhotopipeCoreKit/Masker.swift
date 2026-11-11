import CoreImage
import Foundation
import Vision

/// Finds a mask's pixels: a grey matte the shape of the photo, white where the mask is.
struct Masker {
    typealias Segment = @Sendable (CIImage, Mask.Source, [Mask.Point]) throws -> CIImage

    static let inputLongEdge = 2048
    // bump when the same photo would get a different matte
    static let version = 4

    let cache: CacheFolder
    let segment: Segment
    // a matte is coverage, not colour: managed, a half would come back as a fifth
    private let context = CIContext(options: [.workingColorSpace: NSNull()])
    private let photoContext = CIContext()
    private let clicked = LastPhoto()

    init(cache: CacheFolder, segment: @escaping Segment) {
        self.cache = cache
        self.segment = segment
    }

    static func supports(_ source: Mask.Source) -> Bool {
        source != .click || TapToSegment.isAvailable
    }

    /// `neutral` is the photo before any edit, so one matte serves every edit of it.
    func matte(
        for file: ImageFile, source: Mask.Source, points: [Mask.Point],
        neutral: () throws -> CIImage
    ) throws -> CIImage {
        let key =
            "\(file.path)|\(file.mtime)|\(file.size)|matte|\(source.rawValue)\(points.cacheKey)|v\(Self.version)"
        let url = try cache.cachedFile(at: cache.url(forKey: key, pathExtension: "png")) { temp in
            let photo =
                try source == .click ? clickPhoto(for: file, neutral: neutral) : neutral()
            guard
                let png = context.pngRepresentation(
                    of: try found(in: photo, source: source, points: points), format: .L8,
                    colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)
            else { throw Renderer.RenderError.encodeFailed }
            try png.write(to: temp)
        }
        guard let matte = CIImage(contentsOf: url, options: [.colorSpace: NSNull()]) else {
            throw Renderer.RenderError.unreadable(url.path)
        }
        return matte
    }

    func found(in photo: CIImage, source: Mask.Source, points: [Mask.Point]) throws -> CIImage {
        let segmented = try segment(photo, source, points)
        // Vision answers people in a fixed 3:4 whatever the photo's shape
        return Self.stretched(segmented, over: photo.extent).applyingFilter("CIMaximumComponent")
    }

    /// Drawn once and kept, so the cursor's next question does not wait on a decode.
    func clickPhoto(for file: ImageFile, neutral: () throws -> CIImage) throws -> CIImage {
        try clicked.photo(for: "\(file.path)|\(file.mtime)|\(file.size)") {
            let photo = try neutral()
            // half floats, so lifting the shadows does not band them
            guard
                let drawn = photoContext.createCGImage(
                    photo, from: photo.extent, format: .RGBAh,
                    colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!)
            else { throw Renderer.RenderError.encodeFailed }
            let lifted = CIImage(cgImage: drawn).applyingFilter(
                "CIExposureAdjust", parameters: [kCIInputEVKey: stopsToMiddleGrey(drawn)])
            guard let bright = photoContext.createCGImage(lifted, from: lifted.extent) else {
                throw Renderer.RenderError.encodeFailed
            }
            return CIImage(cgImage: bright)
        }
    }

    // a dark photo hides its edges from the model
    private func stopsToMiddleGrey(_ photo: CGImage) -> Double {
        let image = CIImage(cgImage: photo)
        let average = image.applyingFilter(
            "CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: image.extent)])
        var pixel = [Float](repeating: 0, count: 4)
        photoContext.render(
            average, toBitmap: &pixel, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
            format: .RGBAf, colorSpace: CGColorSpace(name: CGColorSpace.linearSRGB)!)
        let luminance = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]
        let stops = log2(0.18 / max(Double(luminance), 0.001))
        return min(max((stops * 2).rounded() / 2, 0), 4)
    }

    /// The border repeats outward first, or linear sampling fades the matte along the frame.
    static func stretched(_ matte: CIImage, over extent: CGRect) -> CIImage {
        Presence.stretched(matte.clampedToExtent(), from: matte.extent, to: extent)
            .cropped(to: extent)
    }

    static let vision: Segment = { photo, source, points in
        let nothing = CIImage(color: .black).cropped(to: photo.extent)
        let handler = VNImageRequestHandler(ciImage: photo)
        let found: CVPixelBuffer?
        switch source {
        case .click:
            return try TapToSegment.matte(in: photo, at: points) ?? nothing
        case .people:
            let request = VNGeneratePersonSegmentationRequest()
            request.qualityLevel = .accurate
            request.outputPixelFormat = kCVPixelFormatType_OneComponent8
            try handler.perform([request])
            found = request.results?.first?.pixelBuffer
        case .subject:
            let request = VNGenerateForegroundInstanceMaskRequest()
            try handler.perform([request])
            found = try request.results?.first.flatMap { subjects in
                subjects.allInstances.isEmpty
                    ? nil
                    : try subjects.generateScaledMaskForImage(
                        forInstances: subjects.allInstances, from: handler)
            }
        }
        guard let found else { return nothing }
        return CIImage(cvPixelBuffer: found, options: [.colorSpace: NSNull()])
    }
}

private final class LastPhoto: @unchecked Sendable {
    private let lock = NSLock()
    private var last: (key: String, photo: CIImage)?

    func photo(for key: String, orDraw draw: () throws -> CIImage) rethrows -> CIImage {
        if let last = lock.withLock({ last }), last.key == key { return last.photo }
        let photo = try draw()
        lock.withLock { last = (key, photo) }
        return photo
    }
}
