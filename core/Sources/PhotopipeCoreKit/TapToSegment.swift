import CoreImage
import Foundation
import Vision

/// Apple's tap to segment: the object under a click, grown or cut back by the clicks after it.
enum TapToSegment {
    // the request arrives with the macOS 27 SDK, and Swift 6.4 is the first toolchain to carry it
    #if compiler(>=6.4)
        static var isAvailable: Bool {
            if #available(macOS 27, iOS 27, *) { true } else { false }
        }

        /// nil when there is nothing to find: the first click has to include.
        static func matte(in photo: CIImage, at points: [Mask.Point]) throws -> CIImage? {
            guard #available(macOS 27, iOS 27, *), let seed = points.first, seed.include else {
                return nil
            }
            guard let image = photo.cgImage ?? CIContext().createCGImage(photo, from: photo.extent)
            else { throw Renderer.RenderError.encodeFailed }
            let done = DispatchSemaphore(value: 0)
            let answer = Answer()
            Task.detached {
                do {
                    answer.result = .success(try await segment(image, seed: seed, then: points.dropFirst()))
                } catch {
                    answer.result = .failure(error)
                }
                done.signal()
            }
            done.wait()
            return try answer.result.get().map { CIImage(cgImage: $0, options: [.colorSpace: NSNull()]) }
        }

        @available(macOS 27, iOS 27, *)
        private static func segment(
            _ image: CGImage, seed: Mask.Point, then refinements: ArraySlice<Mask.Point>
        ) async throws -> CGImage? {
            let request = GenerateIterativeSegmentationRequest(seedPoint: normalized(seed))
            request.qualityLevel = .accurate
            if case .ready = await request.assetStatus {} else { try await request.downloadAssets() }
            let handler = ImageRequestHandler(image)
            var found = try await handler.perform(request)
            for point in refinements {
                if point.include {
                    try request.addIncludedPoint(normalized(point))
                } else {
                    try request.addExcludedPoint(normalized(point))
                }
                found = try await handler.perform(request)
            }
            return try found?.cgImage
        }

        @available(macOS 27, iOS 27, *)
        private static func normalized(_ point: Mask.Point) -> NormalizedPoint {
            // Vision counts up from the bottom
            NormalizedPoint(x: min(max(point.x, 0), 1), y: 1 - min(max(point.y, 0), 1))
        }

        private final class Answer: @unchecked Sendable {
            var result: Result<CGImage?, any Error> = .success(nil)
        }
    #else
        static let isAvailable = false

        static func matte(in photo: CIImage, at points: [Mask.Point]) throws -> CIImage? { nil }
    #endif
}
