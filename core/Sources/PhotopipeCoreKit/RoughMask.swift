import CoreImage
import Foundation

/// What an older model found, small and hard-edged: it tells the click model where to look.
struct RoughMask: Equatable, Sendable {
    static let longEdge = 320

    let width: Int
    let height: Int
    // rows from the top, like a click
    private var cells: [Bool]

    init(_ matte: CIImage, over photo: CGRect) {
        let scale = Double(Self.longEdge) / max(photo.width, photo.height)
        width = max(1, Int((photo.width * scale).rounded()))
        height = max(1, Int((photo.height * scale).rounded()))
        let frame = CGRect(x: 0, y: 0, width: width, height: height)
        var bytes = [UInt8](repeating: 0, count: width * height)
        Masker.unmanaged.render(
            Masker.stretched(matte.applyingFilter("CIMaximumComponent"), over: frame),
            toBitmap: &bytes, rowBytes: width, bounds: frame, format: .L8, colorSpace: nil)
        cells = bytes.map { $0 > 127 }
    }

    var count: Int { cells.count { $0 } }

    /// The spot furthest from the mask's edge, and how many cells in it lies.
    func deepest() -> (spot: Mask.Point, depth: Int)? {
        var depth = [Int](repeating: 0, count: cells.count)
        for y in 0..<height {
            for x in 0..<width where cells[y * width + x] {
                let left = x > 0 ? depth[y * width + x - 1] : 0
                let above = y > 0 ? depth[(y - 1) * width + x] : 0
                depth[y * width + x] = min(left, above) + 1
            }
        }
        for y in (0..<height).reversed() {
            for x in (0..<width).reversed() where cells[y * width + x] {
                let right = x < width - 1 ? depth[y * width + x + 1] : 0
                let below = y < height - 1 ? depth[(y + 1) * width + x] : 0
                depth[y * width + x] = min(depth[y * width + x], min(right, below) + 1)
            }
        }
        guard let best = depth.indices.max(by: { depth[$0] < depth[$1] }), depth[best] > 0 else {
            return nil
        }
        let spot = Mask.Point(
            x: (Double(best % width) + 0.5) / Double(width),
            y: (Double(best / width) + 0.5) / Double(height), include: true)
        return (spot, depth[best])
    }

    /// Where the next click goes so that `found` grows to cover this mask, nil once little is missed.
    func spotMissed(by found: RoughMask) -> Mask.Point? {
        var missed = self
        for index in cells.indices where found.cells[index] { missed.cells[index] = false }
        guard let deepest = missed.deepest(), deepest.depth >= 4, missed.isMuch(of: self) else {
            return nil
        }
        return deepest.spot
    }

    func isMuch(of whole: RoughMask) -> Bool { count * 20 > whole.count }

    /// `box` in fractions from the top left.
    func inside(_ box: CGRect) -> RoughMask {
        keeping { box.contains($0) }
    }

    func outside(_ boxes: [CGRect]) -> RoughMask {
        keeping { cell in !boxes.contains { $0.contains(cell) } }
    }

    private func keeping(_ keeps: (CGPoint) -> Bool) -> RoughMask {
        var kept = self
        for y in 0..<height {
            for x in 0..<width {
                let cell = CGPoint(
                    x: (Double(x) + 0.5) / Double(width), y: (Double(y) + 0.5) / Double(height))
                if !keeps(cell) { kept.cells[y * width + x] = false }
            }
        }
        return kept
    }

    /// The mask at the photo's size, the way a scribble seed takes it.
    func scribble(width: Int, height: Int) throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(
            nil, width, height, kCVPixelFormatType_OneComponent8,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
        guard let buffer,
            let provider = CGDataProvider(data: Data(cells.map { $0 ? 255 : 0 }) as CFData),
            let image = CGImage(
                width: self.width, height: self.height, bitsPerComponent: 8, bitsPerPixel: 8,
                bytesPerRow: self.width, space: CGColorSpace(name: CGColorSpace.linearGray)!,
                bitmapInfo: [], provider: provider, decode: nil, shouldInterpolate: true,
                intent: .defaultIntent)
        else { throw Renderer.RenderError.encodeFailed }
        Masker.unmanaged.render(
            Masker.stretched(
                CIImage(cgImage: image, options: [.colorSpace: NSNull()]),
                over: CGRect(x: 0, y: 0, width: width, height: height)),
            to: buffer)
        return buffer
    }
}
