import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One XMP tag mutation. `XMP` builds these; the two backends below apply
/// them to a sidecar file or an embedded image.
struct XMPTagOp {
    enum Value {
        case clear
        case scalar(String)
        /// An rdf:Seq of item strings, replacing any existing list wholesale.
        case orderedList([String])
    }

    let namespace: String
    let prefix: String
    let name: String
    let value: Value

    var path: CFString { "\(prefix):\(name)" as CFString }
}

/// Two edits to one photo are a read-modify-write over the same bytes, and
/// the dispatcher answers eight requests at a time. The exiftool daemon used
/// to serialize every write behind a single lock; without one, a rating and
/// an edit landing together silently lose one of the two. Striped so the
/// table cannot grow with the library.
enum PathLock {
    private static let stripes = (0..<64).map { _ in NSLock() }

    static func withLock<T>(_ path: String, _ body: () throws -> T) rethrows -> T {
        let stripe = stripes[Int(UInt(bitPattern: path.hashValue) % UInt(stripes.count))]
        stripe.lock()
        defer { stripe.unlock() }
        return try body()
    }
}

enum XMPWriter {
    public enum WriteError: Error {
        case sidecarUnparseable(String)
        case imageUnreadable(String)
        case applyFailed(String)
        case writeFailed(String)
    }

    /// Patch a sidecar in place: the whole packet is parsed, our tags are
    /// set or removed, and everything else survives the re-serialization.
    static func applyToSidecar(_ ops: [XMPTagOp], sidecar: URL) throws {
        let existing: Data?
        if FileManager.default.fileExists(atPath: sidecar.path) {
            // A sidecar that is there but unreadable must not be replaced by
            // one holding only our tags.
            guard let data = try? Data(contentsOf: sidecar) else {
                throw WriteError.sidecarUnparseable(sidecar.path)
            }
            existing = data
        } else {
            existing = nil
        }
        let metadata: CGMutableImageMetadata
        // Zero bytes hold nothing to protect, so they count as absent.
        if let existing, !existing.isEmpty {
            // Refusing beats clobbering: a sidecar we cannot parse may be
            // another tool's only record of its work.
            guard let parsed = parse(existing),
                let mutable = CGImageMetadataCreateMutableCopy(parsed)
            else { throw WriteError.sidecarUnparseable(sidecar.path) }
            metadata = mutable
        } else {
            metadata = CGImageMetadataCreateMutable()
        }
        try apply(ops, to: metadata, removal: .removeTag)
        guard let data = CGImageMetadataCreateXMPData(metadata, nil) else {
            throw WriteError.writeFailed(sidecar.path)
        }
        try (data as Data).write(to: sidecar, options: .atomic)
    }

    /// Only for a file we just created ourselves, never a user's original:
    /// ImageIO rebuilds the container's tag structures from its own property
    /// model and drops everything it does not model, MakerNotes included.
    /// That is why originals get a sidecar instead.
    static func applyToEmbedded(_ ops: [XMPTagOp], url: URL) throws {
        let metadata = CGImageMetadataCreateMutable()
        try apply(ops, to: metadata, removal: .setNull)
        let temp = try rewrite(
            source: url, besides: url,
            options: [
                kCGImageDestinationMetadata: metadata,
                kCGImageDestinationMergeMetadata: true,
            ])
        do {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
    }

    /// Copies `source` through ImageIO into a fresh temp beside `original`,
    /// which the caller owns and must remove.
    private static func rewrite(
        source: URL, besides original: URL, options: [CFString: Any]
    ) throws -> URL {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
            let type = CGImageSourceGetType(imageSource)
        else { throw WriteError.imageUnreadable(original.path) }
        let temp = original.deletingLastPathComponent()
            .appendingPathComponent(".photopipe-xmp-\(UUID().uuidString)")
            .appendingPathExtension(original.pathExtension)
        guard let destination = CGImageDestinationCreateWithURL(temp as CFURL, type, 1, nil)
        else { throw WriteError.writeFailed(original.path) }
        var error: Unmanaged<CFError>?
        guard
            CGImageDestinationCopyImageSource(
                destination, imageSource, options as CFDictionary, &error)
        else {
            try? FileManager.default.removeItem(at: temp)
            let reason = (error?.takeRetainedValue()).map(String.init(describing:)) ?? original.path
            throw WriteError.writeFailed(reason)
        }
        return temp
    }

    /// ImageIO's XMP parser rejects single-quoted XML attributes, which is
    /// what exiftool writes — including every sidecar Photopipe itself wrote
    /// before the native writer. Retry with attribute quotes normalized;
    /// text content is never touched, an apostrophe in a title survives.
    private static func parse(_ data: Data) -> CGImageMetadata? {
        if let parsed = CGImageMetadataCreateFromXMPData(data as CFData) {
            return parsed
        }
        guard let normalized = normalizeAttributeQuotes(String(decoding: data, as: UTF8.self))
        else { return nil }
        return CGImageMetadataCreateFromXMPData(Data(normalized.utf8) as CFData)
    }

    static func normalizeAttributeQuotes(_ text: String) -> String? {
        var out = String()
        out.reserveCapacity(text.count)
        var rest = Substring(text)

        func copyThrough(_ marker: String) -> Bool {
            guard let range = rest.range(of: marker) else { return false }
            out += rest[..<range.upperBound]
            rest = rest[range.upperBound...]
            return true
        }

        while let char = rest.first {
            if char != "<" {
                out.append(char)
                rest = rest.dropFirst()
                continue
            }
            if rest.hasPrefix("<!--") {
                guard copyThrough("-->") else { return nil }
                continue
            }
            if rest.hasPrefix("<![CDATA[") {
                guard copyThrough("]]>") else { return nil }
                continue
            }
            // Inside a tag or processing instruction: rewrite ='…' to "…",
            // escaping any literal double quote the value carried.
            while let tagChar = rest.first, tagChar != ">" {
                if tagChar == "\"" {
                    out.append("\"")
                    rest = rest.dropFirst()
                    guard copyThrough("\"") else { return nil }
                    continue
                }
                if tagChar == "'" {
                    rest = rest.dropFirst()
                    guard let close = rest.firstIndex(of: "'") else { return nil }
                    out.append("\"")
                    out += rest[..<close].replacingOccurrences(of: "\"", with: "&quot;")
                    out.append("\"")
                    rest = rest[rest.index(after: close)...]
                    continue
                }
                out.append(tagChar)
                rest = rest.dropFirst()
            }
            guard rest.first == ">" else { return nil }
            out.append(">")
            rest = rest.dropFirst()
        }
        return out
    }

    /// Sidecars drop a tag by removing it; the embedded merge drops it by
    /// setting kCFNull, which CGImageDestinationCopyImageSource treats as
    /// "delete from the source's metadata".
    private enum Removal {
        case removeTag
        case setNull
    }

    private static let standardPrefixes: Set<String> = ["xmp", "tiff", "exif", "dc"]

    private static func apply(
        _ ops: [XMPTagOp], to metadata: CGMutableImageMetadata, removal: Removal
    ) throws {
        for op in ops {
            if !standardPrefixes.contains(op.prefix) {
                var registerError: Unmanaged<CFError>?
                CGImageMetadataRegisterNamespaceForPrefix(
                    metadata, op.namespace as CFString, op.prefix as CFString, &registerError)
            }
            switch op.value {
            case .clear:
                switch removal {
                case .removeTag:
                    // Removing an absent tag reports false; that is the
                    // clear-when-already-clear no-op, not a failure.
                    CGImageMetadataRemoveTagWithPath(metadata, nil, op.path)
                case .setNull:
                    guard CGImageMetadataSetValueWithPath(metadata, nil, op.path, kCFNull)
                    else { throw WriteError.applyFailed("\(op.prefix):\(op.name)") }
                }
            case .scalar(let text):
                guard
                    CGImageMetadataSetValueWithPath(metadata, nil, op.path, text as CFString)
                else { throw WriteError.applyFailed("\(op.prefix):\(op.name)") }
            case .orderedList(let items):
                guard
                    let tag = CGImageMetadataTagCreate(
                        op.namespace as CFString, op.prefix as CFString, op.name as CFString,
                        .arrayOrdered, items as CFArray),
                    CGImageMetadataSetTagWithPath(metadata, nil, op.path, tag)
                else { throw WriteError.applyFailed("\(op.prefix):\(op.name)") }
            }
        }
    }
}
