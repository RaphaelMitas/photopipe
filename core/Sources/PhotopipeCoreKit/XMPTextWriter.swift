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
        let existing = try? Data(contentsOf: sidecar)
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
        let withLeadingSpace: Range<Int>
        let value: Range<Int>
    }

    private struct Tag {
        let name: String
        let range: Range<Int>
        let isEnd: Bool
        let isSelfClosing: Bool
        let attributes: [Attribute]
    }

    private struct ChildElement {
        let name: String
        let range: Range<Int>
        /// nil when the element nests others or carries attributes
        let text: Range<Int>?
    }

    /// An `rdf:Description` directly under `rdf:RDF`. Lightroom nests more of
    /// them inside masks, and those repeat names like `crs:ToneCurvePV2012`.
    private struct Description {
        let start: Tag
        let end: Tag?
        let children: [ChildElement]
    }

    private struct Document {
        var descriptions: [Description] = []
        var prefixes: [(prefix: String, uri: String, description: Int?)] = []
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
                        name: attribute, withLeadingSpace: spaceStart..<valueEnd + 1,
                        value: valueStart..<valueEnd))
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
        var child: (start: Tag, nests: Bool)?

        func notePrefixes(_ tag: Tag, description: Int?) {
            for attribute in tag.attributes where attribute.name.hasPrefix("xmlns:") {
                document.prefixes.append(
                    (
                        String(attribute.name.dropFirst("xmlns:".count)),
                        String(decoding: bytes[attribute.value], as: UTF8.self), description
                    ))
            }
        }

        for tag in try scanTags(bytes) {
            guard tag.isEnd else {
                if tag.name == "rdf:Description", stack.last?.name == "rdf:RDF" {
                    notePrefixes(tag, description: document.descriptions.count)
                    if tag.isSelfClosing {
                        document.descriptions.append(Description(start: tag, end: nil, children: []))
                    } else {
                        open = (tag, [], stack.count)
                    }
                } else if let current = open {
                    if stack.count > current.depth + 1 {
                        child?.nests = true
                    } else if tag.isSelfClosing {
                        open?.children.append(
                            ChildElement(name: tag.name, range: tag.range, text: nil))
                    } else {
                        child = (tag, false)
                    }
                } else {
                    notePrefixes(tag, description: nil)
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
                let isSimple = !started.nests && started.start.attributes.isEmpty
                open?.children.append(
                    ChildElement(
                        name: started.start.name,
                        range: started.start.range.lowerBound..<tag.range.upperBound,
                        text: isSimple
                            ? started.start.range.upperBound..<tag.range.lowerBound : nil))
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

    private static func escaped(_ text: String) -> [UInt8] {
        Array(
            text.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
                .replacingOccurrences(of: "\"", with: "&quot;").utf8)
    }

    private static func withLeadingIndent(_ range: Range<Int>, in bytes: [UInt8]) -> Range<Int> {
        var start = range.lowerBound
        while start > 0, bytes[start - 1] == 0x20 || bytes[start - 1] == 0x09 { start -= 1 }
        if start > 0, bytes[start - 1] == 0x0A { start -= 1 }
        return start..<range.upperBound
    }

    private static func removeOne(_ name: String, from bytes: inout [UInt8]) throws -> Bool {
        for description in try parse(bytes).descriptions {
            if let attribute = description.start.attributes.first(where: { $0.name == name }) {
                bytes.removeSubrange(attribute.withLeadingSpace)
                return true
            }
            if let element = description.children.first(where: { $0.name == name }) {
                bytes.removeSubrange(withLeadingIndent(element.range, in: bytes))
                return true
            }
        }
        return false
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
        if let declared = document.prefixes.first(where: { $0.prefix == namespace.prefix }) {
            return document.descriptions[declared.description ?? 0]
        }
        let start = document.descriptions[0].start
        bytes.insert(
            contentsOf: Array(" xmlns:\(namespace.prefix)=\"\(namespace.uri)\"".utf8),
            at: start.range.upperBound - (start.isSelfClosing ? 2 : 1))
        return try parse(bytes).descriptions[0]
    }

    private static func apply(_ tag: XMP.TagWrite, to bytes: inout [UInt8]) throws {
        let name = "\(tag.namespace.prefix):\(tag.name)"
        switch tag.value {
        case .remove:
            while try removeOne(name, from: &bytes) {}
        case .scalar(let value):
            for description in try parse(bytes).descriptions {
                if let attribute = description.start.attributes.first(where: { $0.name == name }) {
                    bytes.replaceSubrange(attribute.value, with: escaped(value))
                    return
                }
                if let element = description.children.first(where: { $0.name == name }) {
                    if let text = element.text {
                        bytes.replaceSubrange(text, with: escaped(value))
                    } else {
                        bytes.replaceSubrange(
                            element.range,
                            with: Array("<\(name)>".utf8) + escaped(value)
                                + Array("</\(name)>".utf8))
                    }
                    return
                }
            }
            let start = try insertionTarget(for: tag.namespace, in: &bytes).start
            // double quotes: the regex reader in XMP.swift matches nothing else
            bytes.insert(
                contentsOf: Array(" \(name)=\"".utf8) + escaped(value) + Array("\"".utf8),
                at: start.range.upperBound - (start.isSelfClosing ? 2 : 1))
        case .list(let items):
            while try removeOne(name, from: &bytes) {}
            let description = try insertionTarget(for: tag.namespace, in: &bytes)
            let element =
                Array("<\(name)><rdf:Seq>".utf8)
                + items.flatMap { Array("<rdf:li>".utf8) + escaped($0) + Array("</rdf:li>".utf8) }
                + Array("</rdf:Seq></\(name)>\n".utf8)
            if let end = description.end {
                bytes.insert(contentsOf: element, at: end.range.lowerBound)
            } else {
                let selfClose = description.start.range.upperBound - 2..<description.start.range.upperBound
                bytes.replaceSubrange(
                    selfClose,
                    with: Array(">\n".utf8) + element + Array("</rdf:Description>".utf8))
            }
        }
    }
}
