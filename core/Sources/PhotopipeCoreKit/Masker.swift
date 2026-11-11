import CoreImage
import Foundation
import Vision

/// Finds a mask's pixels: a grey matte the shape of the photo, white where the mask is.
struct Masker {
    typealias Segment = @Sendable (CIImage, Mask.Source) throws -> CIImage

    static let inputLongEdge = 2048
    // bump when the same photo would get a different matte
    static let version = 4

    let cache: CacheFolder
    let segment: Segment
    // a matte is coverage, not colour: managed, a half would come back as a fifth
    private let context = CIContext(options: [.workingColorSpace: NSNull()])

    init(cache: CacheFolder, segment: @escaping Segment) {
        self.cache = cache
        self.segment = segment
    }

    /// `neutral` is the photo before any edit, so one matte serves every edit of it.
    func matte(
        for file: ImageFile, source: Mask.Source, neutral: () throws -> CIImage
    ) throws -> CIImage {
        let key = "\(file.path)|\(file.mtime)|\(file.size)|matte|\(source.rawValue)|v\(Self.version)"
        let url = try cache.cachedFile(at: cache.url(forKey: key, pathExtension: "png")) { temp in
            let photo = try neutral()
            // Vision answers people in a fixed 3:4 whatever the photo's shape
            let matte = Self.stretched(try segment(photo, source), over: photo.extent)
                .applyingFilter("CIMaximumComponent")
            guard
                let png = context.pngRepresentation(
                    of: matte, format: .L8, colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)
            else { throw Renderer.RenderError.encodeFailed }
            try png.write(to: temp)
        }
        guard let matte = CIImage(contentsOf: url, options: [.colorSpace: NSNull()]) else {
            throw Renderer.RenderError.unreadable(url.path)
        }
        return matte
    }

    /// The border repeats outward first, or linear sampling fades the matte along the frame.
    static func stretched(_ matte: CIImage, over extent: CGRect) -> CIImage {
        Presence.stretched(matte.clampedToExtent(), from: matte.extent, to: extent)
            .cropped(to: extent)
    }

    static let vision: Segment = { photo, source in
        let handler = VNImageRequestHandler(ciImage: photo)
        let found: CVPixelBuffer?
        switch source {
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
        guard let found else { return CIImage(color: .black).cropped(to: photo.extent) }
        return CIImage(cvPixelBuffer: found, options: [.colorSpace: NSNull()])
    }
}
