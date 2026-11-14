import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum Look {
    /// In the order asked: one per photo, or one for the whole sheet.
    public struct Shown: Encodable, Sendable {
        /// Base64, so the reply can go into an MCP image block as it is.
        public let jpeg: String
        public let width: Int
        public let height: Int
    }

    public enum LookError: Error {
        case tooMany(Int, limit: Int)
        case nothingToShow
        case encodeFailed
    }

    public static let separateLimit = 8
    public static let sheetLimit = 64
    static let longEdges = 256...2576
    /// Below the last a frame is not worth looking at; the MCP tool drops what is still over budget.
    static let qualities = [0.85, 0.7, 0.55, 0.4]

    static func grid(count: Int, longEdge: Int) -> (columns: Int, rows: Int, cell: Int) {
        let columns = Int(Double(count).squareRoot().rounded(.up))
        let rows = (count + columns - 1) / columns
        return (columns, rows, longEdge / columns)
    }

    static func framedSize(of file: ImageFile, edit: Edit) -> CGSize {
        Renderer.framedSize(
            CGSize(width: file.width, height: file.height), edit,
            crop: Renderer.saneCrop(edit) ?? .full)
    }

    /// Slid inside the frame rather than cut off at its edge.
    static func viewport(around spot: CGPoint, tile: Int, framed: CGSize) -> CropRect {
        let width = min(Double(tile) / max(framed.width, 1), 1)
        let height = min(Double(tile) / max(framed.height, 1), 1)
        let left = min(max(spot.x - width / 2, 0), 1 - width)
        let top = min(max(spot.y - height / 2, 0), 1 - height)
        return CropRect(left: left, top: top, right: left + width, bottom: top + height)
    }

    static func sheet(_ stills: [CGImage], labels: [String], longEdge: Int) throws -> CGImage {
        let (columns, rows, cell) = grid(count: stills.count, longEdge: longEdge)
        let width = columns * cell
        let height = rows * cell
        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw LookError.encodeFailed }
        context.setFillColor(gray: 0.12, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let gap = CGFloat(max(cell / 64, 1))
        for (index, still) in stills.enumerated() {
            let cellRect = CGRect(
                x: index % columns * cell, y: height - (index / columns + 1) * cell,
                width: cell, height: cell
            ).insetBy(dx: gap, dy: gap)
            context.draw(still, in: fitted(still, in: cellRect))
            drawLabel(labels[index], in: context, cell: cellRect)
        }
        guard let image = context.makeImage() else { throw LookError.encodeFailed }
        return image
    }

    private static func fitted(_ image: CGImage, in rect: CGRect) -> CGRect {
        let scale = min(rect.width / CGFloat(image.width), rect.height / CGFloat(image.height))
        let size = CGSize(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
        return CGRect(
            x: rect.midX - size.width / 2, y: rect.midY - size.height / 2,
            width: size.width, height: size.height)
    }

    private static func drawLabel(_ label: String, in context: CGContext, cell: CGRect) {
        let size = min(max(cell.width / 12, 11), 28)
        let font =
            CTFontCreateUIFontForLanguage(.emphasizedSystem, size, nil)
            ?? CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
        let attributes =
            [
                kCTFontAttributeName: font,
                kCTForegroundColorAttributeName: CGColor(gray: 1, alpha: 1),
            ] as CFDictionary
        let pad = size / 3
        let full = CTLineCreateWithAttributedString(
            CFAttributedStringCreate(nil, label as CFString, attributes))
        let ellipsis = CTLineCreateWithAttributedString(
            CFAttributedStringCreate(nil, "…" as CFString, attributes))
        let line =
            CTLineCreateTruncatedLine(full, Double(cell.width - 4 * pad), .end, ellipsis) ?? full
        let bounds = CTLineGetBoundsWithOptions(line, [])
        let badge = CGRect(
            x: cell.minX + pad, y: cell.maxY - pad - size * 1.4,
            width: bounds.width + 2 * pad, height: size * 1.4)
        context.setFillColor(gray: 0, alpha: 0.75)
        context.fill(badge)
        context.textPosition = CGPoint(
            x: badge.minX + pad, y: badge.midY - (CTFontGetAscent(font) - CTFontGetDescent(font)) / 2)
        CTLineDraw(line, context)
    }

    static func jpeg(_ image: CGImage, maxBytes: Int) throws -> Data {
        for quality in qualities {
            let data = NSMutableData()
            guard
                let destination = CGImageDestinationCreateWithData(
                    data, UTType.jpeg.identifier as CFString, 1, nil)
            else { throw LookError.encodeFailed }
            CGImageDestinationAddImage(
                destination, image,
                [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw LookError.encodeFailed }
            if data.length <= maxBytes || quality == qualities.last { return data as Data }
        }
        throw LookError.encodeFailed
    }

    static func shown(_ image: CGImage, maxBytes: Int) throws -> Shown {
        Shown(
            jpeg: try jpeg(image, maxBytes: maxBytes).base64EncodedString(),
            width: image.width, height: image.height)
    }
}

extension Look.LookError: WireError {
    public var wire: ResponseError {
        switch self {
        case .tooMany(let count, let limit):
            ResponseError(code: "too_many", message: "\(count) photos, at most \(limit) per look")
        case .nothingToShow: ResponseError(code: "invalid_params", message: "paths required")
        case .encodeFailed: ResponseError(code: "encode_failed", message: "could not draw the look")
        }
    }
}
