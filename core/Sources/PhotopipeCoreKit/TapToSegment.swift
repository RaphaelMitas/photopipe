import CoreImage
import Foundation
import Synchronization
import Vision

enum TapToSegment {
    enum Seed: Sendable {
        /// The first has to include: it finds the object, the rest refine it.
        case clicks([Mask.Point])
        case covering(RoughMask)
        case scribbles([RoughMask])
    }

    // the request arrives with the macOS 27 SDK, and Swift 6.4 is the first toolchain to carry it
    #if compiler(>=6.4)
        static var isAvailable: Bool {
            if #available(macOS 27, iOS 27, *) { true } else { false }
        }

        /// Empty when there is nothing to find.
        static func mattes(in photo: CIImage, from seed: Seed) throws -> [CIImage] {
            guard #available(macOS 27, iOS 27, *) else { return [] }
            guard let image = photo.cgImage ?? CIContext().createCGImage(photo, from: photo.extent)
            else { throw Renderer.RenderError.encodeFailed }
            let done = DispatchSemaphore(value: 0)
            let answer = Answer()
            // an export waits here on a thread of Swift's pool, which spares one for this task only while exports stay utility
            Task.detached {
                do {
                    answer.result = .success(try await segment(image, from: seed))
                } catch {
                    answer.result = .failure(error)
                }
                done.signal()
            }
            done.wait()
            return try answer.result.get().map { CIImage(cgImage: $0, options: [.colorSpace: NSNull()]) }
        }

        @available(macOS 27, iOS 27, *)
        private static func segment(_ image: CGImage, from seed: Seed) async throws -> [CGImage] {
            let handler = ImageRequestHandler(image)
            switch seed {
            case .clicks(let points):
                guard let first = points.first, first.include else { return [] }
                var rest = points.dropFirst().makeIterator()
                return try await grown(from: first, with: handler) { _ in rest.next() }
            case .covering(let wanted):
                guard let first = wanted.deepest() else { return [] }
                var clicks = 1
                return try await grown(from: first.spot, with: handler) { found in
                    guard let found, clicks < ownClickLimit else { return nil }
                    clicks += 1
                    let photo = CGRect(x: 0, y: 0, width: image.width, height: image.height)
                    return wanted.spotMissed(
                        by: RoughMask(
                            CIImage(cgImage: found, options: [.colorSpace: NSNull()]), over: photo,
                            context: Masker.unmanaged))
                }
            case .scribbles(let scribbles):
                var found: [CGImage] = []
                for scribble in scribbles {
                    let buffer = try scribble.scribble(
                        width: image.width, height: image.height, context: Masker.unmanaged)
                    let request = try await ready(
                        GenerateIterativeSegmentationRequest(
                            seedScribbleBuffer: CVReadOnlyPixelBuffer(unsafeBuffer: buffer)))
                    if let answer = try await handler.perform(request) {
                        found.append(try answer.cgImage)
                    }
                }
                return found
            }
        }

        private static let ownClickLimit = 8

        /// `next` sees the answer so far and names the click that refines it.
        @available(macOS 27, iOS 27, *)
        private static func grown(
            from seed: Mask.Point, with handler: ImageRequestHandler,
            next: (CGImage?) -> Mask.Point?
        ) async throws -> [CGImage] {
            let request = try await ready(
                GenerateIterativeSegmentationRequest(seedPoint: normalized(seed)))
            var found = try await handler.perform(request)?.cgImage
            while let point = next(found) {
                if point.include {
                    try request.addIncludedPoint(normalized(point))
                } else {
                    try request.addExcludedPoint(normalized(point))
                }
                found = try await handler.perform(request)?.cgImage
            }
            return found.map { [$0] } ?? []
        }

        @available(macOS 27, iOS 27, *)
        private static func ready(
            _ request: GenerateIterativeSegmentationRequest
        ) async throws -> GenerateIterativeSegmentationRequest {
            request.qualityLevel = .accurate
            if case .ready = await request.assetStatus {} else { try await request.downloadAssets() }
            return request
        }

        private enum Model {
            case unasked
            case fetching(DispatchGroup, since: DispatchTime)
            case ready
            case failed(until: DispatchTime)
        }

        private static let model = Mutex(Model.unasked)

        /// A fresh process sees the model missing until a fetch, milliseconds from disk, so wait at most a second for it.
        static func modelArrives() -> Bool {
            guard #available(macOS 27, iOS 27, *) else { return false }
            let fetch: (done: DispatchGroup, since: DispatchTime)? = model.withLock { model in
                switch model {
                case .ready:
                    return nil
                case .failed(let until) where until > .now():
                    return nil
                case .fetching(let done, let since):
                    return (done, since)
                case .unasked, .failed:
                    let done = DispatchGroup()
                    done.enter()
                    let since = DispatchTime.now()
                    model = .fetching(done, since: since)
                    Task.detached {
                        let request = GenerateIterativeSegmentationRequest(
                            seedPoint: NormalizedPoint(x: 0.5, y: 0.5))
                        let arrived = (try? await ready(request)) != nil
                        // a fetch that fails slowly must not cost every render of a drag its wait
                        let failed = Model.failed(until: .now() + .seconds(5))
                        Self.model.withLock { $0 = arrived ? .ready : failed }
                        done.leave()
                    }
                    return (done, since)
                }
            }
            if let fetch { _ = fetch.done.wait(timeout: fetch.since + .seconds(1)) }
            return model.withLock { if case .ready = $0 { true } else { false } }
        }

        @available(macOS 27, iOS 27, *)
        private static func normalized(_ point: Mask.Point) -> NormalizedPoint {
            // Vision counts up from the bottom
            NormalizedPoint(x: min(max(point.x, 0), 1), y: 1 - min(max(point.y, 0), 1))
        }

        private final class Answer: @unchecked Sendable {
            var result: Result<[CGImage], any Error> = .success([])
        }
    #else
        static let isAvailable = false

        static func mattes(in photo: CIImage, from seed: Seed) throws -> [CIImage] { [] }

        static func modelArrives() -> Bool { false }
    #endif
}
