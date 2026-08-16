import Foundation

public enum DispatchOutcome: Equatable, Sendable {
    case respond(Response)
    case shutdown(Response)

    public var response: Response {
        switch self {
        case .respond(let response), .shutdown(let response): response
        }
    }
}

public final class Dispatcher {
    private let library: LibraryService

    public init(library: LibraryService = LibraryService()) {
        self.library = library
    }

    public func dispatch(line: String) -> DispatchOutcome {
        let request: Request
        do {
            request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
        } catch {
            return .respond(
                .failure(
                    id: "", code: "bad_request",
                    message: "malformed request: \(error.localizedDescription)"))
        }

        guard request.v == protocolVersion else {
            return .respond(
                .failure(
                    id: request.id, code: "unsupported_protocol",
                    message: "protocol v\(request.v) not supported, this core speaks v\(protocolVersion)"
                ))
        }

        switch request.method {
        case "ping":
            return .respond(.success(id: request.id, result: .object(["pong": .bool(true)])))
        case "version":
            return .respond(
                .success(
                    id: request.id,
                    result: .object([
                        "version": .string(coreVersion),
                        "protocol": .number(Double(protocolVersion)),
                    ])))
        case "shutdown":
            return .shutdown(.success(id: request.id, result: .object(["bye": .bool(true)])))
        case "setRoot", "listShoots", "listImages", "thumbnail", "render", "setRating",
            "setEdit", "rawDefaults", "status", "reveal", "trash", "exportFiles",
            "createProject", "importFiles", "updateProject", "renameProject",
            "scoreShoot", "scoreStatus":
            return .respond(libraryResponse(request))
        default:
            return .respond(
                .failure(
                    id: request.id, code: "unknown_method",
                    message: "unknown method: \(request.method)"))
        }
    }

    private static func edit(from value: JSONValue?) throws -> Edit? {
        guard let value else { return nil }
        return try JSONDecoder().decode(Edit.self, from: JSONEncoder().encode(value))
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

    private func libraryResponse(_ request: Request) -> Response {
        do {
            switch request.method {
            case "setRoot":
                guard let path = request.params?["path"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "path required")
                }
                let indexPath = request.params?["indexPath"]?.stringValue
                let summary = try library.setRoot(path: path, indexPath: indexPath)
                return .success(
                    id: request.id,
                    result: .object([
                        "shoots": .number(Double(summary.shoots)),
                        "files": .number(Double(summary.files)),
                        "generation": .number(Double(summary.generation)),
                    ]))
            case "listShoots":
                return .success(
                    id: request.id,
                    result: .object(["shoots": try JSONValue(encoding: library.listShoots())]))
            case "listImages":
                guard let shoot = request.params?["shoot"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "shoot required")
                }
                let images = try library.listImages(shoot: shoot)
                return .success(
                    id: request.id, result: .object(["images": try JSONValue(encoding: images)]))
            case "scoreShoot", "scoreStatus":
                guard let shoot = request.params?["shoot"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "shoot required")
                }
                let progress =
                    request.method == "scoreShoot"
                    ? try library.scoreShoot(shoot: shoot)
                    : try library.scoreStatus(shoot: shoot)
                return .success(
                    id: request.id,
                    result: .object([
                        "done": .number(Double(progress.done)),
                        "total": .number(Double(progress.total)),
                        "running": .bool(progress.running),
                    ]))
            case "thumbnail":
                guard let path = request.params?["path"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "path required")
                }
                let maxPixel = request.params?["maxPixel"]?.intValue ?? 256
                let cachePath = try library.thumbnail(path: path, maxPixel: maxPixel)
                return .success(id: request.id, result: .object(["cachePath": .string(cachePath)]))
            case "render":
                guard let path = request.params?["path"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "path required")
                }
                let edit = try Self.edit(from: request.params?["edit"]) ?? .identity
                let maxPixel = request.params?["maxPixel"]?.intValue ?? 2000
                let cachePath = try library.render(
                    path: path, edit: edit, maxPixel: maxPixel,
                    viewport: Self.viewport(from: request.params?["viewport"]))
                return .success(id: request.id, result: .object(["cachePath": .string(cachePath)]))
            case "setRating":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let path = request.params?["path"]?.stringValue,
                    let rating = request.params?["rating"]?.intValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, path and rating required")
                }
                let result = try library.setRating(shoot: shoot, path: path, rating: rating)
                return .success(
                    id: request.id,
                    result: .object([
                        "rating": .number(Double(result.rating)),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "setEdit":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let path = request.params?["path"]?.stringValue,
                    let edit = try Self.edit(from: request.params?["edit"])
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, path and edit required")
                }
                let result = try library.setEdit(shoot: shoot, path: path, edit: edit)
                return .success(
                    id: request.id,
                    result: .object([
                        "edit": try JSONValue(encoding: result.edit),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "rawDefaults":
                guard let path = request.params?["path"]?.stringValue else {
                    return .failure(id: request.id, code: "invalid_params", message: "path required")
                }
                let asShot = try library.rawDefaults(path: path)
                return .success(
                    id: request.id,
                    result: .object([
                        "temperature": asShot.map { .number($0.temperature) } ?? .null,
                        "tint": asShot.map { .number($0.tint) } ?? .null,
                        "denoise": asShot.map { .number($0.denoise * 100) } ?? .null,
                    ]))
            case "reveal":
                guard let paths = request.params?["paths"]?.stringArrayValue else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "paths required")
                }
                try library.reveal(paths: paths)
                return .success(id: request.id, result: .object(["revealed": .bool(true)]))
            case "trash":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let paths = request.params?["paths"]?.stringArrayValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "shoot and paths required")
                }
                let result = try library.trashImages(shoot: shoot, paths: paths)
                return .success(
                    id: request.id,
                    result: .object([
                        "files": .number(Double(result.files)),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "exportFiles":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let paths = request.params?["paths"]?.stringArrayValue,
                    let destination = request.params?["destination"]?.stringValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, paths and destination required")
                }
                let format =
                    LibraryService.ExportFormat(
                        rawValue: request.params?["format"]?.stringValue ?? "original")
                    ?? .original
                let count = try library.exportFiles(
                    shoot: shoot, paths: paths, destination: destination,
                    zip: request.params?["zip"]?.boolValue ?? false,
                    flatten: request.params?["flatten"]?.boolValue ?? true,
                    format: format,
                    quality: request.params?["quality"]?.intValue ?? 90)
                return .success(
                    id: request.id, result: .object(["files": .number(Double(count))]))
            case "createProject":
                guard let day = request.params?["day"]?.stringValue,
                    let name = request.params?["name"]?.stringValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "day and name required")
                }
                let result = try library.createProject(
                    day: day, name: name,
                    notes: request.params?["notes"]?.stringValue ?? "")
                return .success(
                    id: request.id,
                    result: .object([
                        "shoot": .string(result.shoot),
                        "path": .string(result.path),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "importFiles":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let paths = request.params?["paths"]?.stringArrayValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot and paths required")
                }
                let result = try library.importFiles(shoot: shoot, paths: paths)
                return .success(
                    id: request.id,
                    result: .object([
                        "imported": .number(Double(result.imported)),
                        "skipped": .number(Double(result.skipped)),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "updateProject":
                guard let shoot = request.params?["shoot"]?.stringValue else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "shoot required")
                }
                let coverParam = request.params?["cover"]
                let generation = try library.updateProject(
                    shoot: shoot,
                    notes: request.params?["notes"]?.stringValue,
                    cover: coverParam.map { $0.stringValue })
                return .success(
                    id: request.id,
                    result: .object(["generation": .number(Double(generation))]))
            case "renameProject":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let day = request.params?["day"]?.stringValue,
                    let name = request.params?["name"]?.stringValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, day and name required")
                }
                let renamed = try library.renameProject(shoot: shoot, day: day, name: name)
                return .success(
                    id: request.id,
                    result: .object([
                        "shoot": .string(renamed.shoot),
                        "generation": .number(Double(renamed.generation)),
                    ]))
            case "status":
                let status = library.status(since: request.params?["since"]?.intValue)
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
                return .success(id: request.id, result: .object(result))
            default:
                return .failure(id: request.id, code: "unknown_method", message: request.method)
            }
        } catch LibraryService.ServiceError.noRoot {
            return .failure(id: request.id, code: "no_root", message: "call setRoot first")
        } catch LibraryService.ServiceError.unknownShoot(let name) {
            return .failure(id: request.id, code: "unknown_shoot", message: name)
        } catch LibraryService.ServiceError.pathOutsideRoot(let path) {
            return .failure(id: request.id, code: "path_outside_root", message: path)
        } catch LibraryService.ServiceError.unknownImage(let stem) {
            return .failure(id: request.id, code: "unknown_image", message: stem)
        } catch LibraryService.ServiceError.invalidRating(let rating) {
            return .failure(
                id: request.id, code: "invalid_rating", message: "rating \(rating) not in 0...5")
        } catch LibraryService.ServiceError.invalidProjectName(let name) {
            return .failure(
                id: request.id, code: "invalid_project_name",
                message: "\(name) is not a usable project name")
        } catch LibraryService.ServiceError.invalidProjectDay(let day) {
            return .failure(
                id: request.id, code: "invalid_project_day",
                message: "\(day) is not a YYYY-MM-DD date")
        } catch LibraryService.ServiceError.projectExists(let folder) {
            return .failure(
                id: request.id, code: "project_exists", message: "\(folder) already exists")
        } catch FileActions.ActionError.noFiles {
            return .failure(id: request.id, code: "no_files", message: "nothing selected")
        } catch FileActions.ActionError.openFailed(let output) {
            return .failure(id: request.id, code: "open_failed", message: output)
        } catch FileActions.ActionError.zipFailed(let output) {
            return .failure(id: request.id, code: "zip_failed", message: output)
        } catch ExifTool.ExifToolError.notInstalled {
            return .failure(
                id: request.id, code: "exiftool_missing",
                message: "exiftool not found — install it or set PHOTOPIPE_EXIFTOOL")
        } catch ExifTool.ExifToolError.failed(let output) {
            return .failure(id: request.id, code: "exiftool_failed", message: output)
        } catch ScanError.rootNotFound(let path) {
            return .failure(id: request.id, code: "root_not_found", message: path)
        } catch {
            return .failure(id: request.id, code: "io_error", message: "\(error)")
        }
    }
}
