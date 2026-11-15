import CoreGraphics
import Foundation

#if compiler(>=6.4) && canImport(FoundationModels)
    import FoundationModels
#endif

enum Describer {
    struct Unavailable: WireError {
        var wire: ResponseError {
            ResponseError(
                code: "descriptions_unavailable",
                message:
                    "on-device descriptions need macOS 27 with Apple Intelligence on and its model downloaded"
            )
        }
    }

    static let instructions = """
        You describe event photos for a photographer choosing which frames to keep. In under 80 words, \
        say who is in the frame and what they are doing, their expressions and whether eyes look open, \
        how the frame is composed, and anything that spoils it: visible blur, people cut off, something \
        in front of the subject. Plain sentences, no lists, no guessing names, and do not transcribe text in the frame.
        """

    #if compiler(>=6.4) && canImport(FoundationModels)
        static var isAvailable: Bool {
            guard #available(macOS 27, iOS 27, *) else { return false }
            let model = SystemLanguageModel.default
            return model.isAvailable && model.capabilities.contains(.vision)
        }

        static func describe(_ photo: CGImage) throws -> String {
            guard #available(macOS 27, iOS 27, *) else { throw Unavailable() }
            return try awaited {
                let session = LanguageModelSession(instructions: instructions)
                let response = try await session.respond(
                    to: Prompt {
                        "Describe this photo."
                        Attachment(photo)
                    })
                return response.content
            }
        }
    #else
        static let isAvailable = false

        static func describe(_ photo: CGImage) throws -> String { throw Unavailable() }
    #endif
}
