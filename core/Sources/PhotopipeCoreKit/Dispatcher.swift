import Foundation

public final class Dispatcher: Sendable {
    private let library: LibraryService

    public init(library: LibraryService = LibraryService()) {
        self.library = library
    }

    /// The result as JSON, or the error as "code: message".
    public func dispatch(method: String, params: String? = nil) -> (ok: Bool, text: String) {
        let decoded: JSONValue?
        do {
            decoded = try params.map { try JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }
        } catch {
            return (false, "bad_request: malformed params: \(error.localizedDescription)")
        }
        do {
            let result = try result(for: Request(method: method, params: decoded))
            return (true, String(decoding: try JSONEncoder().encode(result), as: UTF8.self))
        } catch let error as WireError {
            return (false, "\(error.wire.code): \(error.wire.message)")
        } catch {
            return (false, "io_error: \(error)")
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

    private func result(for request: Request) throws -> any Encodable {
        switch request.method {
        case "ping":
            return ["pong": true]
        case "imageExtensions":
            return ["extensions": imageExtensions.sorted()]
        case "setRoot":
            return try library.setRoot(
                path: request.string("path"), indexPath: request.param("indexPath")?.stringValue)
        case "listShoots":
            return ["shoots": library.listShoots()]
        case "listImages":
            return ["images": try library.listImages(shoot: request.string("shoot"))]
        case "scoreShoot":
            return try library.scoreShoot(shoot: request.string("shoot"))
        case "stackShoot":
            return try library.stackShoot(shoot: request.string("shoot"))
        case "thumbnail":
            let cachePath = try library.thumbnail(
                path: request.string("path"), maxPixel: request.param("maxPixel")?.intValue ?? 256)
            return ["cachePath": cachePath]
        case "render":
            let cachePath = try library.render(
                path: request.string("path"), edit: request.edit() ?? .identity,
                maxPixel: request.param("maxPixel")?.intValue ?? 2000,
                viewport: Self.viewport(from: request.param("viewport")),
                decoderVersion: request.param("decoderVersion")?.intValue)
            return ["cachePath": cachePath]
        case "setRating":
            return try library.setRating(
                shoot: request.string("shoot"), path: request.string("path"),
                rating: request.int("rating"))
        case "setEdit":
            return try library.setEdit(
                shoot: request.string("shoot"), path: request.string("path"),
                edit: required("edit", request.edit()))
        case "rawDefaults":
            let asShot = try library.rawDefaults(
                path: request.string("path"),
                decoderVersion: request.param("decoderVersion")?.intValue)
            return [
                "temperature": asShot?.temperature, "tint": asShot?.tint,
                "denoise": asShot.map { $0.denoise * 100 },
            ]
        case "trash":
            return try library.trashImages(
                shoot: request.string("shoot"), paths: request.strings("paths"))
        case "decoderAvailability":
            return ["raw9": library.raw9Availability()]
        case "decoderSupport":
            return try library.decoderSupport(paths: request.strings("paths"))
        case "exportFiles":
            return try library.startExport(
                shoot: request.string("shoot"), paths: request.strings("paths"),
                destination: request.string("destination"),
                zip: request.param("zip")?.boolValue ?? false,
                flatten: request.param("flatten")?.boolValue ?? true,
                format: ExportFormat(rawValue: request.param("format")?.stringValue ?? "original")
                    ?? .original,
                quality: request.param("quality")?.intValue ?? 90,
                longEdge: request.param("longEdge")?.intValue,
                decoderVersion: request.param("decoderVersion")?.intValue)
        case "exportStatus":
            return try library.exportStatus(id: request.string("id"))
        case "cancelExport":
            return try library.cancelExport(id: request.string("id"))
        case "createProject":
            return try library.createProject(
                name: request.string("name"), notes: request.string("notes"))
        case "importFiles":
            return try library.startImport(
                shoot: request.string("shoot"), paths: request.strings("paths"))
        case "updateProject":
            return try library.updateProject(
                shoot: request.string("shoot"), name: request.string("name"),
                day: request.param("day")?.stringValue, notes: request.string("notes"),
                cover: request.param("cover")?.stringValue)
        case "captureDate":
            let day = try library.captureDate(path: request.string("path"))
            return ["day": day]
        case "rescan":
            library.rescanNow()
            return [String: String]()
        case "status":
            return library.status(since: request.param("since")?.intValue)
        default:
            throw DispatchError.unknownMethod(request.method)
        }
    }
}

private enum DispatchError: WireError {
    case invalidParams(String)
    case unknownMethod(String)

    var wire: ResponseError {
        switch self {
        case .invalidParams(let key): ResponseError(code: "invalid_params", message: "\(key) required")
        case .unknownMethod(let method):
            ResponseError(code: "unknown_method", message: "unknown method: \(method)")
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
