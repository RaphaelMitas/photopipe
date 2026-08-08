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
        case "setRoot", "listShoots", "listImages", "thumbnail", "render", "setRating", "status":
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
