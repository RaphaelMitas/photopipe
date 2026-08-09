import Foundation

public enum DispatchOutcome: Equatable, Sendable {
    case respond(Response)
    /// Respond, then the caller should exit the read loop.
    case shutdown(Response)

    public var response: Response {
        switch self {
        case .respond(let response), .shutdown(let response): response
        }
    }
}

/// Routes protocol requests. Envelope handling is pure; library methods hit
/// the stateful service.
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
        case "setRoot", "listShoots", "listImages", "thumbnail", "render", "setRating", "status",
            "openIn", "reveal", "trash", "exportFiles", "createProject", "importFiles",
            "updateProject", "renameProject":
            return .respond(libraryResponse(request))
        default:
            return .respond(
                .failure(
                    id: request.id, code: "unknown_method",
                    message: "unknown method: \(request.method)"))
        }
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
                let exposure = request.params?["exposure"]?.doubleValue ?? 0
                let maxPixel = request.params?["maxPixel"]?.intValue ?? 2000
                let cachePath = try library.render(
                    path: path, exposure: exposure, maxPixel: maxPixel)
                return .success(id: request.id, result: .object(["cachePath": .string(cachePath)]))
            case "setRating":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let stem = request.params?["stem"]?.stringValue,
                    let rating = request.params?["rating"]?.intValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, stem and rating required")
                }
                let result = try library.setRating(shoot: shoot, stem: stem, rating: rating)
                return .success(
                    id: request.id,
                    result: .object([
                        "rating": .number(Double(result.rating)),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "openIn":
                guard let paths = request.params?["paths"]?.stringArrayValue,
                    let app = request.params?["app"]?.stringValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "paths and app required")
                }
                try library.openIn(paths: paths, app: app)
                return .success(
                    id: request.id, result: .object(["opened": .number(Double(paths.count))]))
            case "reveal":
                guard let paths = request.params?["paths"]?.stringArrayValue else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "paths required")
                }
                try library.reveal(paths: paths)
                return .success(id: request.id, result: .object(["revealed": .bool(true)]))
            case "trash":
                guard let shoot = request.params?["shoot"]?.stringValue,
                    let stems = request.params?["stems"]?.stringArrayValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params", message: "shoot and stems required")
                }
                let result = try library.trashImages(shoot: shoot, stems: stems)
                return .success(
                    id: request.id,
                    result: .object([
                        "files": .number(Double(result.files)),
                        "generation": .number(Double(result.generation)),
                    ]))
            case "exportFiles":
                guard let paths = request.params?["paths"]?.stringArrayValue,
                    let destination = request.params?["destination"]?.stringValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "paths and destination required")
                }
                let zip = request.params?["zip"]?.boolValue ?? false
                let count = try library.exportFiles(
                    paths: paths, destination: destination, zip: zip)
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
                    let stageName = request.params?["stage"]?.stringValue,
                    let stage = Stage(rawValue: stageName),
                    let paths = request.params?["paths"]?.stringArrayValue
                else {
                    return .failure(
                        id: request.id, code: "invalid_params",
                        message: "shoot, stage and paths required")
                }
                let result = try library.importFiles(shoot: shoot, stage: stage, paths: paths)
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
                // An absent key leaves the field alone; an explicit null
                // clears the cover back to "first image".
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
                let status = library.status()
                return .success(
                    id: request.id,
                    result: .object([
                        "generation": .number(Double(status.generation)),
                        "root": status.root.map { .string($0) } ?? .null,
                        "shoots": .number(Double(status.shoots)),
                    ]))
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
        } catch LibraryService.ServiceError.projectExists(let folder) {
            return .failure(
                id: request.id, code: "project_exists", message: "\(folder) already exists")
        } catch FileActions.ActionError.noFiles {
            return .failure(id: request.id, code: "no_files", message: "nothing selected")
        } catch FileActions.ActionError.noApp {
            return .failure(id: request.id, code: "no_app", message: "no application chosen")
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
