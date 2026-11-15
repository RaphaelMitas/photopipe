import CoreImage
import Foundation
import Vision

struct Masker {
    typealias Segment = @Sendable (CIImage, Mask.Source, [Mask.Point]) throws -> CIImage

    static let inputLongEdge = 2048
    static let version = 5

    let cache: CacheFolder
    let segment: Segment
    static let unmanaged = CIContext(options: [.workingColorSpace: NSNull()])
    private let photoContext = CIContext()
    private let brightened = LastPhoto()
    private let cutting = NSLock()

    init(cache: CacheFolder, segment: @escaping Segment) {
        self.cache = cache
        self.segment = segment
    }

    static var isAvailable: Bool { TapToSegment.isAvailable }

    func matte(
        for pixelStamp: String, source: Mask.Source, points: [Mask.Point],
        neutral: () throws -> CIImage
    ) throws -> CIImage {
        let key = "\(pixelStamp)|matte|\(source.rawValue)\(points.cacheKey)|v\(Self.version)"
        let url = cache.url(forKey: key, pathExtension: "png")
        if !cache.isCached(url) {
            _ = try cutting.withLock {
                try cache.cachedFile(at: url) { temp in
                    guard
                        let png = Self.unmanaged.pngRepresentation(
                            of: try found(
                                in: try brightPhoto(for: pixelStamp, neutral: neutral), source: source,
                                points: points), format: .L8,
                            colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)
                    else { throw Renderer.RenderError.encodeFailed }
                    try png.write(to: temp)
                }
            }
        }
        guard let matte = CIImage(contentsOf: url, options: [.colorSpace: NSNull()]) else {
            throw Renderer.RenderError.unreadable(url.path)
        }
        return matte
    }

    func found(in photo: CIImage, source: Mask.Source, points: [Mask.Point]) throws -> CIImage {
        Self.stretched(try segment(photo, source, points), over: photo.extent)
            .applyingFilter("CIMaximumComponent")
    }

    func brightPhoto(for pixelStamp: String, neutral: () throws -> CIImage) throws -> CIImage {
        try brightened.photo(for: pixelStamp) {
            let photo = try neutral()
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

    static func stretched(_ matte: CIImage, over extent: CGRect) -> CIImage {
        Presence.stretched(matte.clampedToExtent(), from: matte.extent, to: extent)
            .cropped(to: extent)
    }

    static let vision: Segment = { photo, source, points in
        let nothing = CIImage(color: .black).cropped(to: photo.extent)
        lazy var handler = VNImageRequestHandler(ciImage: photo)
        func rough(_ found: CVPixelBuffer) -> RoughMask {
            RoughMask(
                CIImage(cvPixelBuffer: found, options: [.colorSpace: NSNull()]), over: photo.extent)
        }
        var seed = TapToSegment.Seed.clicks(points)
        switch source {
        case .click:
            break
        case .subject:
            let request = VNGenerateForegroundInstanceMaskRequest()
            try handler.perform([request])
            guard let subjects = request.results?.first, !subjects.allInstances.isEmpty else {
                return nothing
            }
            seed = .covering(
                rough(
                    try subjects.generateScaledMaskForImage(
                        forInstances: subjects.allInstances, from: handler)))
        case .people:
            let everyone = VNGeneratePersonSegmentationRequest()
            everyone.qualityLevel = .accurate
            everyone.outputPixelFormat = kCVPixelFormatType_OneComponent8
            let bodies = VNDetectHumanRectanglesRequest()
            bodies.upperBodyOnly = false
            try handler.perform([everyone, bodies])
            guard let crowd = everyone.results?.first.map({ rough($0.pixelBuffer) }), crowd.count > 0
            else { return nothing }
            let boxes = (bodies.results ?? []).map { body in
                let box = body.boundingBox
                return CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
            }
            let missed = [crowd.outside(boxes)].filter { $0.isMuch(of: crowd) }
            seed = .scribbles(boxes.map(crowd.inside).filter { $0.count > 0 } + missed)
        }
        let found = try TapToSegment.mattes(in: photo, from: seed).map {
            stretched($0, over: photo.extent)
        }
        return found.dropFirst().reduce(found.first) { union, matte in
            matte.applyingFilter(
                "CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: union as Any])
        } ?? nothing
    }
}

private final class LastPhoto: @unchecked Sendable {
    private let lock = NSLock()
    private var last: (key: String, photo: CIImage)?

    func photo(for key: String, orDraw draw: () throws -> CIImage) rethrows -> CIImage {
        try lock.withLock {
            if let last, last.key == key { return last.photo }
            let photo = try draw()
            last = (key, photo)
            return photo
        }
    }
}
