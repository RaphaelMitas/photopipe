import Foundation

/// Sidecar writer for platforms that cannot spawn exiftool. Edits only the
/// properties it owns, byte-wise, so everything else in the file survives.
enum XMPTextWriter {
    enum WriteError: Error {
        case malformed(String)
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

    static func write(_ tags: [XMP.TagWrite], to sidecar: URL, clearing: Bool) throws {
        writeLock.lock()
        defer { writeLock.unlock() }
        let existing: Data?
        do {
            existing = try Data(contentsOf: sidecar)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            existing = nil
        }
        if existing == nil && clearing { return }
        let bytes = try apply(tags, to: existing.map(Array.init) ?? Array(freshSidecar.utf8))
        try Data(bytes).write(to: sidecar, options: .atomic)
    }

    static func apply(_ tags: [XMP.TagWrite], to original: [UInt8]) throws -> [UInt8] {
        var bytes = original
        try refuseForeignPrefixes(in: parse(bytes))
        for tag in tags {
            try apply(tag, to: &bytes)
        }
        return bytes
    }

    private struct Attribute {
        let name: String
        let range: Range<Int>
        let withLeadingSpace: Range<Int>
        let value: Range<Int>
    }

    private struct Tag {
        let name: String
        let range: Range<Int>
        let isEnd: Bool
        let isSelfClosing: Bool
        let attributes: [Attribute]

        var attributeInsertionPoint: Int { range.upperBound - (isSelfClosing ? 2 : 1) }
    }

    private struct ChildElement {
        let name: String
        let range: Range<Int>
    }

    /// An `rdf:Description` directly under `rdf:RDF`. Lightroom nests more of
    /// them inside masks, and those repeat names like `crs:ToneCurvePV2012`.
    private struct Description {
        let start: Tag
        let end: Tag?
        let children: [ChildElement]
    }

    private enum PrefixScope {
        case aboveDescriptions
        case description(Int)
        case nested
    }

    private struct Document {
        var descriptions: [Description] = []
        var prefixes: [(prefix: String, uri: String, scope: PrefixScope)] = []
        var rdfEnd: Tag?
    }

    private static let skipped = [("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>")]

    private static func find(_ needle: String, in bytes: [UInt8], from start: Int) -> Int? {
        let needle = Array(needle.utf8)
        guard bytes.count >= needle.count else { return nil }
        return (start...max(start, bytes.count - needle.count)).first {
            bytes[$0...].starts(with: needle)
        }
    }

    private static func isSpace(_ byte: UInt8) -> Bool {
        byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09
    }

    private static func scanTags(_ bytes: [UInt8]) throws -> [Tag] {
        let lessThan = UInt8(ascii: "<")
        let greaterThan = UInt8(ascii: ">")
        let slash = UInt8(ascii: "/")
        let equals = UInt8(ascii: "=")
        var tags: [Tag] = []
        var index = 0
        while index < bytes.count {
            guard bytes[index] == lessThan else {
                index += 1
                continue
            }
            if let (open, close) = skipped.first(where: { bytes[index...].starts(with: $0.0.utf8) }) {
                guard let end = find(close, in: bytes, from: index) else {
                    throw WriteError.malformed("unterminated \(open)")
                }
                index = end + close.utf8.count
                continue
            }
            let start = index
            index += 1
            let isEnd = index < bytes.count && bytes[index] == slash
            if isEnd { index += 1 }
            let nameStart = index
            while index < bytes.count, !isSpace(bytes[index]), bytes[index] != greaterThan,
                bytes[index] != slash
            {
                index += 1
            }
            let name = String(decoding: bytes[nameStart..<index], as: UTF8.self)
            var attributes: [Attribute] = []
            while index < bytes.count, bytes[index] != greaterThan {
                let spaceStart = index
                while index < bytes.count, isSpace(bytes[index]) { index += 1 }
                guard index < bytes.count, bytes[index] != greaterThan else { continue }
                if bytes[index] == slash {
                    index += 1
                    continue
                }
                let attributeStart = index
                while index < bytes.count, bytes[index] != equals, !isSpace(bytes[index]),
                    bytes[index] != greaterThan
                {
                    index += 1
                }
                let attribute = String(decoding: bytes[attributeStart..<index], as: UTF8.self)
                while index < bytes.count, isSpace(bytes[index]) || bytes[index] == equals {
                    index += 1
                }
                guard index < bytes.count,
                    bytes[index] == UInt8(ascii: "\"") || bytes[index] == UInt8(ascii: "'")
                else { throw WriteError.malformed("attribute \(attribute) in <\(name)>") }
                let quote = bytes[index]
                let valueStart = index + 1
                guard let valueEnd = bytes[valueStart...].firstIndex(of: quote) else {
                    throw WriteError.malformed("unterminated attribute \(attribute)")
                }
                attributes.append(
                    Attribute(
                        name: attribute, range: attributeStart..<valueEnd + 1,
                        withLeadingSpace: spaceStart..<valueEnd + 1, value: valueStart..<valueEnd))
                index = valueEnd + 1
            }
            guard index < bytes.count else { throw WriteError.malformed("unterminated <\(name)") }
            tags.append(
                Tag(
                    name: name, range: start..<index + 1, isEnd: isEnd,
                    isSelfClosing: bytes[index - 1] == slash, attributes: attributes))
            index += 1
        }
        return tags
    }

    private static func parse(_ bytes: [UInt8]) throws -> Document {
        var document = Document()
        var stack: [Tag] = []
        var open: (start: Tag, children: [ChildElement], depth: Int)?
        var child: Tag?

        func notePrefixes(_ tag: Tag, scope: PrefixScope) {
            for attribute in tag.attributes where attribute.name.hasPrefix("xmlns:") {
                document.prefixes.append(
                    (
                        String(attribute.name.dropFirst("xmlns:".count)),
                        String(decoding: bytes[attribute.value], as: UTF8.self), scope
                    ))
            }
        }

        for tag in try scanTags(bytes) {
            guard tag.isEnd else {
                if tag.name == "rdf:Description", stack.last?.name == "rdf:RDF", open == nil {
                    notePrefixes(tag, scope: .description(document.descriptions.count))
                    if tag.isSelfClosing {
                        document.descriptions.append(Description(start: tag, end: nil, children: []))
                    } else {
                        open = (tag, [], stack.count)
                    }
                } else if let current = open {
                    notePrefixes(tag, scope: .nested)
                    if stack.count == current.depth + 1 {
                        if tag.isSelfClosing {
                            open?.children.append(ChildElement(name: tag.name, range: tag.range))
                        } else {
                            child = tag
                        }
                    }
                } else {
                    notePrefixes(tag, scope: .aboveDescriptions)
                }
                if !tag.isSelfClosing { stack.append(tag) }
                continue
            }
            guard let opened = stack.popLast(), opened.name == tag.name else {
                throw WriteError.malformed("mismatched </\(tag.name)>")
            }
            if tag.name == "rdf:RDF" { document.rdfEnd = tag }
            guard let current = open else { continue }
            if stack.count == current.depth + 1, let started = child {
                open?.children.append(
                    ChildElement(
                        name: started.name, range: started.range.lowerBound..<tag.range.upperBound))
                child = nil
            } else if stack.count == current.depth {
                document.descriptions.append(
                    Description(start: current.start, end: tag, children: current.children))
                open = nil
            }
        }
        guard stack.isEmpty else { throw WriteError.malformed("unclosed <\(stack.last!.name)>") }
        return document
    }

    // exiftool follows a namespace to whatever prefix the file binds it to;
    // this writer and the regex reader only know the conventional ones
    private static func refuseForeignPrefixes(in document: Document) throws {
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
        try parse(bytes).descriptions.flatMap { description in
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
    ) throws -> Description {
        var document = try parse(bytes)
        if document.descriptions.isEmpty {
            // exiftool leaves an empty rdf:RDF behind once every tag is cleared
            guard let rdfEnd = document.rdfEnd else { throw WriteError.malformed("no rdf:RDF") }
            bytes.insert(
                contentsOf: Array(" <rdf:Description rdf:about=''/>\n".utf8),
                at: rdfEnd.range.lowerBound)
            document = try parse(bytes)
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
        return try parse(bytes).descriptions[0]
    }

    private static func apply(_ tag: XMP.TagWrite, to bytes: inout [UInt8]) throws {
        let name = "\(tag.namespace.prefix):\(tag.name)"
        // double quotes: the regex reader in XMP.swift matches nothing else
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

        // the first occurrence is rewritten where it stands: moving a curve
        // behind crs:Look lets the first-match reader find the look's curve
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
