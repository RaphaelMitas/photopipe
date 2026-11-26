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
    let upstream: URL
    let runner: Runner
    let files: [ModelFile]

    var bytes: Int { files.reduce(0) { $0 + $1.bytes } }

    var folderName: String {
        let digest = SHA256.hash(data: Data(files.map(\.sha256).joined(separator: "\n").utf8))
        return "\(id)-\(digest.hex.prefix(12))"
    }
}

extension ModelEntry {
    static let lama = ModelEntry(
        id: "lama-1", name: "Big-LaMa", licence: "Apache-2.0",
        upstream: URL(string: "https://huggingface.co/smartywu/big-lama")!, runner: .lama1024,
        files: [
            release(
                "model-lama-1", "Manifest.json", path: "Manifest.json",
                sha256: "8486242b6de6a7693efc3368cb3f50f1adc912a242d1b8944f955ce41d850aab", bytes: 617),
            release(
                "model-lama-1", "model.mlmodel", path: "Data/com.apple.CoreML/model.mlmodel",
                sha256: "240f4e54309f0cd760ca622a08999dff669635b2190919f96c8f248f62cab97d",
                bytes: 1_247_048),
            release(
                "model-lama-1", "weight.bin", path: "Data/com.apple.CoreML/weights/weight.bin",
                sha256: "efbcc81069be7d10eccd0a434bfda24a0c56da109beebb3ea630a55bcbd5caeb",
                bytes: 204_163_068),
        ])

    static let catalog = [lama]

    static let fillHole = lama

    private static func release(
        _ tag: String, _ name: String, path: String, sha256: String, bytes: Int
    ) -> ModelFile {
        ModelFile(
            url: URL(string: "https://github.com/RaphaelMitas/photopipe/releases/download/\(tag)/\(name)")!,
            path: path, sha256: sha256, bytes: bytes)
    }
}
