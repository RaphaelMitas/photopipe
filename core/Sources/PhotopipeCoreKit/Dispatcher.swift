import Foundation

public final class Dispatcher {
    private let library: LibraryService

    public init(library: LibraryService = LibraryService()) {
        self.library = library
    }

    public func dispatch(line: String) -> Response {
        let request: Request
        do {
            request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
        } catch {
            return .failure(
                id: "", code: "bad_request",
                message: "malformed request: \(error.localizedDescription)")
        }

        guard request.v == protocolVersion else {
            return .failure(
                id: request.id, code: "unsupported_protocol",
                message: "protocol v\(request.v) not supported, this core speaks v\(protocolVersion)")
        }

        do {
            return .success(id: request.id, result: try result(for: request))
        } catch let error as WireError {
            return .failure(id: request.id, code: error.wire.code, message: error.wire.message)
        } catch {
            return .failure(id: request.id, code: "io_error", message: "\(error)")
        }
    }

    /// Dropped rather than rejected when malformed: a bad viewport should cost
    /// the caller a whole-frame render, not an error mid-gesture.
    static func viewport(from value: JSONValue?) -> CropRect? {
        guard let value,
            let left = value["left"]?.doubleValue, let top = value["top"]?.doubleValue,
            let right = value["right"]?.doubleValue, let bottom = value["bottom"]?.doubleValue
        else { return nil }
        return CropRect(left: left, top: top, right: right, bottom: bottom).sanitized()
    }

    private static func exportProgress(_ job: Exporter.Progress) -> JSONValue {
        .object([
            "id": .string(job.id),
            "done": .number(Double(job.done)),
            "failed": .number(Double(job.failed)),
            "total": .number(Double(job.total)),
            "running": .bool(job.running),
            "cancelled": .bool(job.cancelled),
            "archiving": .bool(job.archiving),
            "error": job.error.map { .string($0) } ?? .null,
            "failures": .array(job.failures.map { .string($0) }),
        ])
    }

    private func result(for request: Request) throws -> JSONValue {
        switch request.method {
        case "ping":
            return .object(["pong": .bool(true)])
        case "version":
            return .object([
                "version": .string(coreVersion),
                "protocol": .number(Double(protocolVersion)),
            ])
        case "shutdown":
            library.stopExports()
            return .object(["bye": .bool(true)])
        case "setRoot":
            let summary = try library.setRoot(
                path: request.string("path"), indexPath: request.param("indexPath")?.stringValue)
            return .object([
                "shoots": .number(Double(summary.shoots)),
                "files": .number(Double(summary.files)),
                "generation": .number(Double(summary.generation)),
            ])
        case "listShoots":
            return .object(["shoots": try JSONValue(encoding: library.listShoots())])
        case "listImages":
            let images = try library.listImages(shoot: request.string("shoot"))
            return .object(["images": try JSONValue(encoding: images)])
        case "scoreShoot":
            let progress = try library.scoreShoot(shoot: request.string("shoot"))
            return .object([
                "done": .number(Double(progress.done)),
                "total": .number(Double(progress.total)),
                "running": .bool(progress.running),
            ])
        case "thumbnail":
            let cachePath = try library.thumbnail(
                path: request.string("path"), maxPixel: request.param("maxPixel")?.intValue ?? 256)
            return .object(["cachePath": .string(cachePath)])
        case "render":
            let cachePath = try library.render(
                path: request.string("path"), edit: request.edit() ?? .identity,
                maxPixel: request.param("maxPixel")?.intValue ?? 2000,
                viewport: Self.viewport(from: request.param("viewport")),
                decoderVersion: request.param("decoderVersion")?.intValue)
            return .object(["cachePath": .string(cachePath)])
        case "setRating":
            let result = try library.setRating(
                shoot: request.string("shoot"), path: request.string("path"),
                rating: request.int("rating"))
            return .object([
                "rating": .number(Double(result.rating)),
                "generation": .number(Double(result.generation)),
            ])
        case "setEdit":
            let result = try library.setEdit(
                shoot: request.string("shoot"), path: request.string("path"),
                edit: required("edit", request.edit()))
            return .object([
                "edit": try JSONValue(encoding: result.edit),
                "generation": .number(Double(result.generation)),
            ])
        case "rawDefaults":
            let asShot = try library.rawDefaults(
                path: request.string("path"),
                decoderVersion: request.param("decoderVersion")?.intValue)
            return .object([
                "temperature": asShot.map { .number($0.temperature) } ?? .null,
                "tint": asShot.map { .number($0.tint) } ?? .null,
                "denoise": asShot.map { .number($0.denoise * 100) } ?? .null,
            ])
        case "trash":
            let result = try library.trashImages(
                shoot: request.string("shoot"), paths: request.strings("paths"))
            return .object([
                "files": .number(Double(result.files)),
                "generation": .number(Double(result.generation)),
            ])
        case "decoderAvailability":
            return .object(["raw9": library.raw9Availability().map(JSONValue.bool) ?? .null])
        case "decoderSupport":
            let support = try library.decoderSupport(paths: request.strings("paths"))
            return .object([
                "raw9": .number(Double(support.raw9)),
                "rawTotal": .number(Double(support.rawTotal)),
            ])
        case "exportFiles":
            let job = try library.startExport(
                shoot: request.string("shoot"), paths: request.strings("paths"),
                destination: request.string("destination"),
                zip: request.param("zip")?.boolValue ?? false,
                flatten: request.param("flatten")?.boolValue ?? true,
                format: ExportFormat(rawValue: request.param("format")?.stringValue ?? "original")
                    ?? .original,
                quality: request.param("quality")?.intValue ?? 90,
                decoderVersion: request.param("decoderVersion")?.intValue)
            return Self.exportProgress(job)
        case "exportStatus":
            return Self.exportProgress(try library.exportStatus(id: request.string("id")))
        case "cancelExport":
            return Self.exportProgress(try library.cancelExport(id: request.string("id")))
        case "createProject":
            let result = try library.createProject(
                name: request.string("name"), notes: request.string("notes"))
            return .object([
                "shoot": .string(result.shoot),
                "path": .string(result.path),
                "generation": .number(Double(result.generation)),
            ])
        case "importFiles":
            let job = try library.startImport(
                shoot: request.string("shoot"), paths: request.strings("paths"))
            return Self.exportProgress(job)
        case "updateProject":
            let updated = try library.updateProject(
                shoot: request.string("shoot"), name: request.string("name"),
                day: request.param("day")?.stringValue, notes: request.string("notes"),
                cover: request.param("cover")?.stringValue)
            return .object([
                "shoot": .string(updated.shoot),
                "generation": .number(Double(updated.generation)),
            ])
        case "captureDate":
            let day = try library.captureDate(path: request.string("path"))
            return .object(["day": day.map(JSONValue.string) ?? .null])
        case "status":
            let status = library.status(since: request.param("since")?.intValue)
            var result: [String: JSONValue] = [
                "generation": .number(Double(status.generation)),
                "root": status.root.map { .string($0) } ?? .null,
                "shoots": .number(Double(status.shoots)),
                "scanning": .bool(status.scanning),
                "filesFound": .number(Double(status.filesFound)),
                "filesEnriched": .number(Double(status.filesEnriched)),
            ]
            if let changed = status.changedShoots {
                result["changedShoots"] = .array(changed.map { .string($0) })
            }
            return .object(result)
        default:
            throw DispatchError.unknownMethod(request.method)
        }
    }
}

private enum DispatchError: WireError {
    case invalidParams(String)
    case unknownMethod(String)

    var wire: (code: String, message: String) {
        switch self {
        case .invalidParams(let key): ("invalid_params", "\(key) required")
        case .unknownMethod(let method): ("unknown_method", "unknown method: \(method)")
        }
    }
}

private func required<Value>(_ key: String, _ value: Value?) throws -> Value {
    guard let value else { throw DispatchError.invalidParams(key) }
    return value
}

extension Request {
    fileprivate func param(_ key: String) -> JSONValue? { params?[key] }

    fileprivate func string(_ key: String) throws -> String {
        try required(key, param(key)?.stringValue)
    }

    fileprivate func int(_ key: String) throws -> Int {
        try required(key, param(key)?.intValue)
    }

    fileprivate func strings(_ key: String) throws -> [String] {
        try required(key, param(key)?.stringArrayValue)
    }

    fileprivate func edit() throws -> Edit? {
        guard let value = param("edit") else { return nil }
        return try JSONDecoder().decode(Edit.self, from: JSONEncoder().encode(value))
    }
}
