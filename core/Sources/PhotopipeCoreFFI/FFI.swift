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

    /// Replies with the picked paths as a JSON array. Picked in place rather than
    /// copied in, so a card's worth of raws is read once, by the import.
    @_cdecl("photopipe_pick_photos")
    public func pickPhotos(_ context: UnsafeMutableRawPointer?, _ reply: Reply) {
        nonisolated(unsafe) let context = context
        nonisolated(unsafe) let reply = reply
        DispatchQueue.main.async {
            let types = imageExtensions.compactMap { UTType(filenameExtension: $0) }
            Picker.present(types: types, multiple: true) { urls in
                let paths = urls.filter { $0.startAccessingSecurityScopedResource() }.map(\.path)
                guard let json = try? JSONEncoder().encode(paths) else {
                    return reply(context, false, nil)
                }
                String(decoding: json, as: UTF8.self).withCString { reply(context, true, $0) }
            }
        }
    }

    @MainActor
    private final class Picker: NSObject, UIDocumentPickerDelegate,
        UIAdaptivePresentationControllerDelegate
    {
        private static var current: Picker?
        private let done: ([URL]) -> Void

        private init(done: @escaping ([URL]) -> Void) {
            self.done = done
        }

        static func present(types: [UTType], multiple: Bool, done: @escaping ([URL]) -> Void) {
            let presenter = UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .first
            // UIKit silently refuses to present over another sheet, and then nothing would reply
            guard let presenter, current == nil, presenter.presentedViewController == nil else {
                return done([])
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
            picker.allowsMultipleSelection = multiple
            let delegate = Picker(done: done)
            picker.delegate = delegate
            picker.presentationController?.delegate = delegate
            current = delegate
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
#endif
