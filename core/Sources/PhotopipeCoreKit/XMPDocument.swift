import Foundation

/// Byte ranges of an XMP packet down to the properties of its top-level
/// rdf:Descriptions, the depth both the reader and XMPTextWriter work at.
struct XMPDocument {
    struct Malformed: Error {
        let reason: String
    }

    struct Attribute {
        let name: String
        let range: Range<Int>
        let withLeadingSpace: Range<Int>
        let value: Range<Int>
    }

    struct Tag {
        let name: String
        let range: Range<Int>
        let isEnd: Bool
        let isSelfClosing: Bool
        let attributes: [Attribute]

        var attributeInsertionPoint: Int { range.upperBound - (isSelfClosing ? 2 : 1) }
    }

    struct ChildElement {
        let name: String
        let range: Range<Int>
        let namespaces: [String: String]
        let content: Range<Int>?
        let items: [Range<Int>]
    }

    // Lightroom's mask Descriptions repeat names like crs:ToneCurvePV2012
    struct TopLevelDescription {
        let start: Tag
        let end: Tag?
        let namespaces: [String: String]
        let children: [ChildElement]
    }

    enum PrefixScope {
        case aboveDescriptions
        case description(Int)
        case nested
    }

    var descriptions: [TopLevelDescription] = []
    var prefixes: [(prefix: String, uri: String, scope: PrefixScope)] = []
    var rdfEnd: Tag?

    private static let skipped = [("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>")]

    private static func isSpace(_ byte: UInt8) -> Bool {
        byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09
    }

    /// Stops at the first malformation and returns what came before it.
    private static func scanTags(_ bytes: [UInt8]) -> (tags: [Tag], malformed: String?) {
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
                guard let end = bytes[index...].firstRange(of: Array(close.utf8)) else {
                    return (tags, "unterminated \(open)")
                }
                index = end.upperBound
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
                else { return (tags, "attribute \(attribute) in <\(name)>") }
                let quote = bytes[index]
                let valueStart = index + 1
                guard let valueEnd = bytes[valueStart...].firstIndex(of: quote) else {
                    return (tags, "unterminated attribute \(attribute)")
                }
                attributes.append(
                    Attribute(
                        name: attribute, range: attributeStart..<valueEnd + 1,
                        withLeadingSpace: spaceStart..<valueEnd + 1, value: valueStart..<valueEnd))
                index = valueEnd + 1
            }
            guard index < bytes.count else { return (tags, "unterminated <\(name)") }
            tags.append(
                Tag(
                    name: name, range: start..<index + 1, isEnd: isEnd,
                    isSelfClosing: bytes[index - 1] == slash, attributes: attributes))
            index += 1
        }
        return (tags, nil)
    }

    /// `lenient` keeps everything before the first malformation instead of
    /// throwing, including a Description it cut off.
    static func parse(_ bytes: [UInt8], lenient: Bool = false) throws -> XMPDocument {
        let (tags, malformed) = scanTags(bytes)
        if let malformed, !lenient { throw Malformed(reason: malformed) }
        var document = XMPDocument()
        var stack: [(tag: Tag, namespaces: [String: String])] = []
        var open: (start: Tag, namespaces: [String: String], children: [ChildElement], depth: Int)?
        var child: (start: Tag, namespaces: [String: String], items: [Range<Int>])?
        var item: Tag?

        for tag in tags {
            guard tag.isEnd else {
                let declared = tag.attributes.filter { $0.name.hasPrefix("xmlns:") }.map {
                    (
                        prefix: String($0.name.dropFirst("xmlns:".count)),
                        uri: String(decoding: bytes[$0.value], as: UTF8.self)
                    )
                }
                let namespaces = declared.reduce(into: stack.last?.namespaces ?? [:]) {
                    $0[$1.prefix] = $1.uri
                }
                let scope: PrefixScope
                if tag.name == "rdf:Description", stack.last?.tag.name == "rdf:RDF", open == nil {
                    scope = .description(document.descriptions.count)
                    if tag.isSelfClosing {
                        document.descriptions.append(
                            TopLevelDescription(
                                start: tag, end: nil, namespaces: namespaces, children: []))
                    } else {
                        open = (tag, namespaces, [], stack.count)
                    }
                } else if let current = open {
                    scope = .nested
                    let level = stack.count - current.depth
                    if level == 1, tag.isSelfClosing {
                        open?.children.append(
                            ChildElement(
                                name: tag.name, range: tag.range, namespaces: namespaces,
                                content: nil, items: []))
                    } else if level == 1 {
                        child = (tag, namespaces, [])
                    } else if level == 3, tag.name == "rdf:li", !tag.isSelfClosing {
                        item = tag
                    }
                } else {
                    scope = .aboveDescriptions
                }
                document.prefixes += declared.map { ($0.prefix, $0.uri, scope) }
                if !tag.isSelfClosing { stack.append((tag, namespaces)) }
                continue
            }
            guard let opened = stack.popLast(), opened.tag.name == tag.name else {
                if lenient { break }
                throw Malformed(reason: "mismatched </\(tag.name)>")
            }
            if tag.name == "rdf:RDF" { document.rdfEnd = tag }
            guard let current = open else { continue }
            let level = stack.count - current.depth
            if level == 3, let started = item {
                child?.items.append(started.range.upperBound..<tag.range.lowerBound)
                item = nil
            } else if level == 1, let started = child {
                open?.children.append(
                    ChildElement(
                        name: started.start.name,
                        range: started.start.range.lowerBound..<tag.range.upperBound,
                        namespaces: started.namespaces,
                        content: started.start.range.upperBound..<tag.range.lowerBound,
                        items: started.items))
                child = nil
            } else if level == 0 {
                document.descriptions.append(
                    TopLevelDescription(
                        start: current.start, end: tag, namespaces: current.namespaces,
                        children: current.children))
                open = nil
            }
        }
        if lenient, let current = open {
            document.descriptions.append(
                TopLevelDescription(
                    start: current.start, end: nil, namespaces: current.namespaces,
                    children: current.children))
        } else if !lenient, let unclosed = stack.last {
            throw Malformed(reason: "unclosed <\(unclosed.tag.name)>")
        }
        return document
    }
}

/// What a reader may take from a packet: only the direct properties of the
/// top-level Descriptions, keyed by namespace URI rather than prefix.
struct XMPProperties {
    private struct Key: Hashable {
        let uri: String
        let name: String
    }

    private var values: [Key: [String]] = [:]

    init(_ packet: some Collection<UInt8>) {
        let bytes = Array(packet)
        guard let document = try? XMPDocument.parse(bytes, lenient: true) else { return }
        for description in document.descriptions {
            for attribute in description.start.attributes {
                add(attribute.name, description.namespaces, [attribute.value], in: bytes)
            }
            for child in description.children {
                let ranges = child.items.isEmpty ? child.content.map { [$0] } ?? [] : child.items
                add(child.name, child.namespaces, ranges, in: bytes)
            }
        }
    }

    private mutating func add(
        _ qualifiedName: String, _ namespaces: [String: String], _ ranges: [Range<Int>],
        in bytes: [UInt8]
    ) {
        let parts = qualifiedName.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, let uri = namespaces[String(parts[0])] else { return }
        let key = Key(uri: uri, name: String(parts[1]))
        guard values[key] == nil else { return }
        values[key] = ranges.map {
            Self.decoded(String(decoding: bytes[$0], as: UTF8.self))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    func value(_ namespace: XMP.TagWrite.Namespace, _ name: String) -> String? {
        values[Key(uri: namespace.uri, name: name)]?.first
    }

    func items(_ namespace: XMP.TagWrite.Namespace, _ name: String) -> [String] {
        values[Key(uri: namespace.uri, name: name)] ?? []
    }

    private static let namedEntities: [Substring: Unicode.Scalar] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
    ]

    static func decoded(_ text: String) -> String {
        guard text.contains("&") else { return text }
        return text.replacing(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/) { match in
            let entity = match.1
            let scalar =
                entity.hasPrefix("#x")
                ? UInt32(entity.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init)
                : entity.hasPrefix("#")
                    ? UInt32(entity.dropFirst()).flatMap(Unicode.Scalar.init)
                    : namedEntities[entity]
            return scalar.map { String(Character($0)) } ?? String(match.0)
        }
    }
}
