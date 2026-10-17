import Foundation

/// Sidecar writer for platforms that cannot spawn exiftool. Edits only the
/// properties it owns, byte-wise, so everything else in the file survives.
enum XMPTextWriter {
    enum WriteError: Error {
        case foreignPrefix(String)
    }

    private static let freshSidecar = """
        <?xpacket begin='\u{FEFF}' id='W5M0MpCehiHzreSzNTczkc9d'?>
        <x:xmpmeta xmlns:x='adobe:ns:meta/' x:xmptk='Photopipe'>
        <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
         <rdf:Description rdf:about=''/>
        </rdf:RDF>
        </x:xmpmeta>
        <?xpacket end='w'?>

        """

    // exiftool serialized writes through its one process; here nothing else does
    private static let writeLock = NSLock()

    /// `seed` runs under the lock, so two writes racing to start a sidecar cannot seed over each other.
    static func write(
        _ tags: [XMP.TagWrite], to sidecar: URL, clearing: Bool,
        seed: () throws -> [XMP.TagWrite] = { [] }
    ) throws {
        writeLock.lock()
        defer { writeLock.unlock() }
        let existing = try XMP.isOwnSidecar(sidecar) ? Data(contentsOf: sidecar) : nil
        var tags = tags
        if existing == nil {
            let seeded = try seed()
            if seeded.isEmpty && clearing { return }
            tags = seeded + tags
        }
        let bytes = try apply(tags, to: existing.map(Array.init) ?? Array(freshSidecar.utf8))
        try Data(bytes).write(to: sidecar, options: .atomic)
    }

    static func apply(_ tags: [XMP.TagWrite], to original: [UInt8]) throws -> [UInt8] {
        var bytes = original
        try refuseForeignPrefixes(in: XMPDocument.parse(bytes))
        for tag in tags {
            try apply(tag, to: &bytes)
        }
        return bytes
    }

    // exiftool follows a namespace to whatever prefix the file binds it to;
    // this writer only knows the conventional ones
    private static func refuseForeignPrefixes(in document: XMPDocument) throws {
        for namespace in XMP.TagWrite.Namespace.allCases {
            for bound in document.prefixes
            where (bound.prefix == namespace.prefix) != (bound.uri == namespace.uri) {
                throw WriteError.foreignPrefix("\(bound.prefix) = \(bound.uri)")
            }
        }
    }

    private static func escaped(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func withLeadingIndent(_ range: Range<Int>, in bytes: [UInt8]) -> Range<Int> {
        var start = range.lowerBound
        while start > 0, bytes[start - 1] == 0x20 || bytes[start - 1] == 0x09 { start -= 1 }
        if start > 0, bytes[start - 1] == 0x0A { start -= 1 }
        return start..<range.upperBound
    }

    private struct Occurrence {
        let range: Range<Int>
        let withLeadingSpace: Range<Int>
        let isAttribute: Bool
    }

    private static func occurrences(of name: String, in bytes: [UInt8]) throws -> [Occurrence] {
        try XMPDocument.parse(bytes).descriptions.flatMap { description in
            description.start.attributes.filter { $0.name == name }.map {
                Occurrence(range: $0.range, withLeadingSpace: $0.withLeadingSpace, isAttribute: true)
            }
                + description.children.filter { $0.name == name }.map {
                    Occurrence(
                        range: $0.range, withLeadingSpace: withLeadingIndent($0.range, in: bytes),
                        isAttribute: false)
                }
        }
    }

    private static func insertionTarget(
        for namespace: XMP.TagWrite.Namespace, in bytes: inout [UInt8]
    ) throws -> XMPDocument.TopLevelDescription {
        var document = try XMPDocument.parse(bytes)
        if document.descriptions.isEmpty {
            // exiftool leaves an empty rdf:RDF behind once every tag is cleared
            guard let rdfEnd = document.rdfEnd else { throw XMPDocument.Malformed(reason: "no rdf:RDF") }
            bytes.insert(
                contentsOf: Array(" <rdf:Description rdf:about=''/>\n".utf8),
                at: rdfEnd.range.lowerBound)
            document = try XMPDocument.parse(bytes)
        }
        for declared in document.prefixes where declared.prefix == namespace.prefix {
            switch declared.scope {
            case .aboveDescriptions: return document.descriptions[0]
            case .description(let index): return document.descriptions[index]
            case .nested: continue
            }
        }
        bytes.insert(
            contentsOf: Array(" xmlns:\(namespace.prefix)=\"\(namespace.uri)\"".utf8),
            at: document.descriptions[0].start.attributeInsertionPoint)
        return try XMPDocument.parse(bytes).descriptions[0]
    }

    private static func apply(_ tag: XMP.TagWrite, to bytes: inout [UInt8]) throws {
        let name = "\(tag.namespace.prefix):\(tag.name)"
        let (attribute, element): (String?, String?) =
            switch tag.value {
            case .remove: (nil, nil)
            case .scalar(let value):
                ("\(name)=\"\(escaped(value))\"", "<\(name)>\(escaped(value))</\(name)>")
            case .list(let items):
                (
                    nil,
                    "<\(name)><rdf:Seq>"
                        + items.map { "<rdf:li>\(escaped($0))</rdf:li>" }.joined()
                        + "</rdf:Seq></\(name)>"
                )
            }

        let found = try occurrences(of: name, in: bytes)
        for duplicate in found.dropFirst().reversed() {
            bytes.removeSubrange(duplicate.withLeadingSpace)
        }
        if let first = found.first {
            if let inPlace = first.isAttribute ? attribute : element {
                bytes.replaceSubrange(first.range, with: Array(inPlace.utf8))
                return
            }
            bytes.removeSubrange(first.withLeadingSpace)
        }

        if let attribute {
            let start = try insertionTarget(for: tag.namespace, in: &bytes).start
            bytes.insert(contentsOf: Array(" \(attribute)".utf8), at: start.attributeInsertionPoint)
        } else if let element {
            let description = try insertionTarget(for: tag.namespace, in: &bytes)
            if let end = description.end {
                bytes.insert(contentsOf: Array("\(element)\n".utf8), at: end.range.lowerBound)
            } else {
                let start = description.start
                bytes.replaceSubrange(
                    start.attributeInsertionPoint..<start.range.upperBound,
                    with: Array(">\n\(element)\n</rdf:Description>".utf8))
            }
        }
    }
}
