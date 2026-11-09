import CoreImage
import Foundation
import ImageIO

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    print("=== \(url.lastPathComponent)")
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { print("no CGImageSource"); continue }
    print("type", CGImageSourceGetType(source) as Any, "count", CGImageSourceGetCount(source))
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
    print("top-level", props.filter { !($0.value is [CFString: Any]) }.map { "\($0.key)=\($0.value)" }.sorted())
    print("dicts", props.filter { $0.value is [CFString: Any] }.keys.map { $0 as String }.sorted())
    if let file = CGImageSourceCopyProperties(source, nil) as? [CFString: Any] { print("file-level", file) }
    let full = CGImageSourceCreateImageAtIndex(source, 0, nil)
    print("CGImageSourceCreateImageAtIndex", full.map { "\($0.width)x\($0.height)" } ?? "nil")
    let thumb = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [kCGImageSourceCreateThumbnailFromImageIfAbsent: true, kCGImageSourceThumbnailMaxPixelSize: 4096,
         kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
    print("embedded thumbnail", thumb.map { "\($0.width)x\($0.height)" } ?? "nil")
    let always = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 4096] as CFDictionary)
    print("thumbnail from full decode", always.map { "\($0.width)x\($0.height)" } ?? "nil")
    if let filter = CIRAWFilter(imageURL: url) {
        print("CIRAWFilter(url) ok native", filter.nativeSize, "versions", filter.supportedDecoderVersions.map(\.rawValue),
              "output", filter.outputImage?.extent as Any)
    } else {
        print("CIRAWFilter(url) nil")
    }
    let data = try! Data(contentsOf: url)
    let hint = CGImageSourceGetType(source).map { $0 as String } ?? ""
    if let filter = CIRAWFilter(imageData: data, identifierHint: hint) {
        print("CIRAWFilter(data) ok native", filter.nativeSize, "output", filter.outputImage?.extent as Any)
    } else {
        print("CIRAWFilter(data, \(hint)) nil")
    }
    print("CIImage(contentsOf)", CIImage(contentsOf: url)?.extent as Any)
}
print("supported raw cameras containing S5:", CIRAWFilter.supportedCameraModels.filter { $0.contains("S5") })
