import Foundation
import PhotopipeCoreKit

public typealias Reply =
    @convention(c) (UnsafeMutableRawPointer?, Bool, UnsafePointer<CChar>?) ->
    Void

/// Calls `reply` exactly once, from a background thread, with the result JSON or "code: message".
@_cdecl("photopipe_core_request")
public func request(
    _ method: UnsafePointer<CChar>, _ params: UnsafePointer<CChar>?,
    _ context: UnsafeMutableRawPointer?, _ reply: Reply
) {
    nonisolated(unsafe) let context = context
    CoreHost.shared.submit(
        method: String(cString: method), params: params.map { String(cString: $0) }
    ) { ok, text in
        text.withCString { reply(context, ok, $0) }
    }
}

@_cdecl("photopipe_core_shutdown")
public func shutdown() {
    CoreHost.shared.shutdown()
}

#if os(iOS)
    import ImageIO
    import PhotosUI
    import UIKit
    import UniformTypeIdentifiers
    import WebKit

    /// The UI assumes nothing overlaps it, so the webview stops at the status bar and home indicator.
    @_cdecl("photopipe_fit_to_safe_area")
    public func fitToSafeArea(_ webview: UnsafeMutableRawPointer) {
        nonisolated(unsafe) let webview = webview
        MainActor.assumeIsolated {
            let webview = Unmanaged<WKWebView>.fromOpaque(webview).takeUnretainedValue()
            guard let container = webview.superview else { return }
            webview.scrollView.contentInsetAdjustmentBehavior = .never
            webview.translatesAutoresizingMaskIntoConstraints = false
            let safe = container.safeAreaLayoutGuide
            NSLayoutConstraint.activate([
                webview.topAnchor.constraint(equalTo: safe.topAnchor),
                webview.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
                webview.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
                webview.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            ])
        }
    }

    /// The scope is never stopped: the core reads the folder for the life of the process.
    @_cdecl("photopipe_pick_folder")
    public func pickFolder(_ context: UnsafeMutableRawPointer?, _ reply: Reply) {
        nonisolated(unsafe) let context = context
        nonisolated(unsafe) let reply = reply
        DispatchQueue.main.async {
            Picker.present(types: [.folder], multiple: false) { urls in
                guard let url = urls.first, url.startAccessingSecurityScopedResource() else {
                    return reply(context, false, nil)
                }
                url.path.withCString { reply(context, true, $0) }
            }
        }
    }

    /// Replies with the picked paths as a JSON array. Files are picked in place
    /// rather than copied in, so a card's worth of raws is read once, by the import.
    @_cdecl("photopipe_pick_photos")
    public func pickPhotos(
        _ fromLibrary: Bool, _ context: UnsafeMutableRawPointer?, _ reply: Reply
    ) {
        nonisolated(unsafe) let context = context
        nonisolated(unsafe) let reply = reply
        DispatchQueue.main.async {
            let picked = { (urls: [URL]) in
                guard let json = try? JSONEncoder().encode(urls.map(\.path)) else {
                    return reply(context, false, nil)
                }
                String(decoding: json, as: UTF8.self).withCString { reply(context, true, $0) }
            }
            if fromLibrary {
                Picker.presentLibrary(done: picked)
            } else {
                let types = imageExtensions.compactMap { UTType(filenameExtension: $0) }
                Picker.present(types: types, multiple: true) { urls in
                    picked(urls.filter { $0.startAccessingSecurityScopedResource() })
                }
            }
        }
    }

    @MainActor
    private final class Picker: NSObject, UIDocumentPickerDelegate, PHPickerViewControllerDelegate,
        UIAdaptivePresentationControllerDelegate
    {
        private static var current: Picker?
        private let done: ([URL]) -> Void

        private init(done: @escaping ([URL]) -> Void) {
            self.done = done
        }

        static func present(types: [UTType], multiple: Bool, done: @escaping ([URL]) -> Void) {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
            picker.allowsMultipleSelection = multiple
            show(picker, done: done) { picker.delegate = $0 }
        }

        static func presentLibrary(done: @escaping ([URL]) -> Void) {
            var configuration = PHPickerConfiguration()
            configuration.filter = .images
            configuration.selectionLimit = 0
            // the original file, so a raw stays a raw
            configuration.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: configuration)
            show(picker, done: done) { picker.delegate = $0 }
        }

        private static func show(
            _ picker: UIViewController, done: @escaping ([URL]) -> Void,
            delegate: (Picker) -> Void
        ) {
            let presenter = UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .first
            // UIKit silently refuses to present over another sheet, and then nothing would reply
            guard let presenter, current == nil, presenter.presentedViewController == nil else {
                return done([])
            }
            let handler = Picker(done: done)
            delegate(handler)
            picker.presentationController?.delegate = handler
            current = handler
            presenter.present(picker, animated: true)
        }

        func documentPicker(
            _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
        ) {
            finish(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            finish([])
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            LibraryCopies.save(results.map(\.itemProvider)) { [weak self] urls in
                self?.finish(urls)
            }
        }

        /// A swipe down dismisses the sheet without calling documentPickerWasCancelled.
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            finish([])
        }

        /// Replies once even if a dismissal reports itself twice.
        private func finish(_ urls: [URL]) {
            guard Self.current === self else { return }
            Self.current = nil
            done(urls)
        }
    }

    /// Photos lends a file only for the length of a callback, so each pick is
    /// copied out; one the core cannot read, like a HEIC, is written as a JPEG.
    private enum LibraryCopies {
        static func save(
            _ providers: [NSItemProvider], done: @escaping @MainActor ([URL]) -> Void
        ) {
            let folder = FileManager.default.temporaryDirectory
                .appendingPathComponent("Photos import", isDirectory: true)
            sweep(folder)
            let pick = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let saved = Saved()
            let group = DispatchGroup()
            for (index, provider) in providers.enumerated() {
                let types = provider.registeredContentTypes
                guard
                    let type = types.first(where: { $0.conforms(to: .rawImage) })
                        ?? types.first(where: { $0.conforms(to: .image) })
                else { continue }
                let name = provider.suggestedName
                group.enter()
                _ = provider.loadFileRepresentation(for: type) { url, _, _ in
                    defer { group.leave() }
                    guard let url else { return }
                    let item = pick.appendingPathComponent("\(index)", isDirectory: true)
                    saved.add(index, copy(url, named: name, into: item))
                }
            }
            group.notify(queue: .main) {
                MainActor.assumeIsolated { done(saved.inOrder) }
            }
        }

        private static func copy(_ url: URL, named name: String?, into folder: URL) -> URL? {
            let stem = name ?? url.deletingPathExtension().lastPathComponent
            let target = folder.appendingPathComponent(stem).appendingPathExtension(url.pathExtension)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                if isImagePath(target.path) {
                    try FileManager.default.copyItem(at: url, to: target)
                    return target
                }
            } catch {
                return nil
            }
            let jpeg = target.deletingPathExtension().appendingPathExtension("jpg")
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                let destination = CGImageDestinationCreateWithURL(
                    jpeg as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
            else { return nil }
            CGImageDestinationAddImageFromSource(destination, source, 0, nil)
            return CGImageDestinationFinalize(destination) ? jpeg : nil
        }

        /// The import copies out of these, so they are only cleared once surely done with.
        private static func sweep(_ folder: URL) {
            let dayAgo = Date().addingTimeInterval(-86_400)
            let picks =
                (try? FileManager.default.contentsOfDirectory(
                    at: folder, includingPropertiesForKeys: [.creationDateKey])) ?? []
            for pick in picks {
                let created = try? pick.resourceValues(forKeys: [.creationDateKey]).creationDate
                if (created ?? .distantPast) < dayAgo { try? FileManager.default.removeItem(at: pick) }
            }
        }
    }

    private final class Saved: @unchecked Sendable {
        private let lock = NSLock()
        private var urls: [Int: URL] = [:]

        func add(_ index: Int, _ url: URL?) {
            lock.withLock { urls[index] = url }
        }

        var inOrder: [URL] {
            lock.withLock { urls.sorted { $0.key < $1.key }.map(\.value) }
        }
    }
#endif
