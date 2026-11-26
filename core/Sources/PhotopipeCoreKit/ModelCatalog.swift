import CryptoKit
import Foundation

struct ModelFile: Sendable {
    let url: URL
    let path: String
    let sha256: String
    let bytes: Int

    var isInsidePackage: Bool {
        !path.isEmpty && !path.hasPrefix("/")
            && !path.split(separator: "/", omittingEmptySubsequences: false).contains {
                $0.isEmpty || $0 == "." || $0 == ".."
            }
    }
}

enum Runner: Sendable {
    case lama1024
}

struct ModelEntry: Sendable {
    let id: String
    let name: String
    let licence: String
    let runner: Runner
    let files: [ModelFile]

    var bytes: Int { files.reduce(0) { $0 + $1.bytes } }

    var folderName: String {
        let digest = SHA256.hash(data: Data(files.map(\.sha256).joined(separator: "\n").utf8))
        return "\(id)-\(digest.hex.prefix(12))"
    }
}

extension ModelEntry {
    static let lama = released(
        id: "lama-1", name: "Big-LaMa", licence: "Apache-2.0", runner: .lama1024,
        files: [
            (
                "Manifest.json",
                "8486242b6de6a7693efc3368cb3f50f1adc912a242d1b8944f955ce41d850aab", 617
            ),
            (
                "Data/com.apple.CoreML/model.mlmodel",
                "240f4e54309f0cd760ca622a08999dff669635b2190919f96c8f248f62cab97d", 1_247_048
            ),
            (
                "Data/com.apple.CoreML/weights/weight.bin",
                "efbcc81069be7d10eccd0a434bfda24a0c56da109beebb3ea630a55bcbd5caeb", 204_163_068
            ),
        ])

    static let catalog = [lama]

    static let fillHole = lama

    private static func released(
        id: String, name: String, licence: String, runner: Runner,
        files: [(path: String, sha256: String, bytes: Int)]
    ) -> ModelEntry {
        let release = "https://github.com/RaphaelMitas/photopipe/releases/download/model-\(id)/"
        return ModelEntry(
            id: id, name: name, licence: licence, runner: runner,
            files: files.map { file in
                ModelFile(
                    url: URL(string: release + (file.path.split(separator: "/").last ?? ""))!,
                    path: file.path, sha256: file.sha256, bytes: file.bytes)
            })
    }
}
