import Foundation

public enum ExportFormat: String, Sendable {
    case original
    case jpeg
}

extension Exporter.Plan {
    static func export(
        _ images: [ImageFile], to destination: String, zip: Bool, flatten: Bool,
        format: ExportFormat, quality: Int, decoderVersion: Int?, renderer: Renderer
    ) throws -> Exporter.Plan {
        let fm = FileManager.default
        let staging =
            zip
            ? fm.temporaryDirectory
                .appendingPathComponent("photopipe-export-\(UUID().uuidString)")
            : nil
        let base = staging ?? URL(fileURLWithPath: destination)

        var used: Set<String> = []
        let items = images.map { image in
            var rel = image.rel
            if format == .jpeg {
                rel = (rel as NSString).deletingPathExtension + ".jpg"
            }
            if flatten {
                rel = (rel as NSString).lastPathComponent
            }
            let name = FileActions.uniqueName(rel) { candidate in
                used.contains(candidate.lowercased())
                    || (staging == nil
                        && fm.fileExists(atPath: base.appendingPathComponent(candidate).path))
            }
            used.insert(name.lowercased())
            let target = base.appendingPathComponent(name)
            // An export carries the real edit and rating even where enrichment
            // has not reached yet. Reading them opens the file, so it happens in
            // the writers, four wide, rather than in the request that plans it.
            return Item(label: image.rel) {
                try write(
                    enrich(image), format: format, quality: quality, to: target, staging: zip,
                    decoderVersion: decoderVersion, renderer: renderer)
            }
        }

        if let staging { try fm.createDirectory(at: staging, withIntermediateDirectories: true) }
        return Exporter.Plan(items: items, destination: destination, staging: staging)
    }

    private static func write(
        _ image: ImageFile, format: ExportFormat, quality: Int, to planned: URL, staging: Bool,
        decoderVersion: Int?, renderer: Renderer
    ) throws {
        let fm = FileManager.default
        try fm.createDirectory(
            at: planned.deletingLastPathComponent(), withIntermediateDirectories: true)
        switch format {
        case .original:
            let source = URL(fileURLWithPath: image.path)
            if staging {
                do { try fm.linkItem(at: source, to: planned) } catch {
                    try fm.copyItem(at: source, to: planned)
                }
            } else {
                try FileActions.copyWithoutOverwriting(from: source, to: planned)
            }
        case .jpeg:
            // A name picked before the first write can be taken by the time the
            // render lands, and a render cannot retry one the way a copy does.
            let target =
                staging || !fm.fileExists(atPath: planned.path)
                ? planned : FileActions.uniqueURL(for: planned)
            try renderer.exportJPEG(
                file: image, edit: image.edit,
                quality: Double(quality) / 100, to: target,
                decoderVersion: decoderVersion)
            #if os(macOS)
                if image.rating > 0 {
                    try? ExifTool.shared.write(
                        ["-overwrite_original", "-XMP:Rating=\(image.rating)", target.path])
                }
            #endif
        }
    }
}
