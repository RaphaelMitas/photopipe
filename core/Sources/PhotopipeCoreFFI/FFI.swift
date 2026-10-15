import Foundation
import PhotopipeCoreKit

public typealias Reply = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void

/// Calls `reply` exactly once with the response line, from a background thread.
@_cdecl("photopipe_core_request")
public func request(
    _ line: UnsafePointer<CChar>, _ context: UnsafeMutableRawPointer?, _ reply: Reply
) {
    nonisolated(unsafe) let context = context
    CoreHost.shared.submit(String(cString: line)) { response in
        response.withCString { reply(context, $0) }
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
            FolderPicker.present { url in
                guard let url, url.startAccessingSecurityScopedResource() else {
                    return reply(context, nil)
                }
                url.path.withCString { reply(context, $0) }
            }
        }
    }

    @MainActor
    private final class FolderPicker: NSObject, UIDocumentPickerDelegate,
        UIAdaptivePresentationControllerDelegate
    {
        private static var current: FolderPicker?
        private let done: (URL?) -> Void

        private init(done: @escaping (URL?) -> Void) {
            self.done = done
        }

        static func present(done: @escaping (URL?) -> Void) {
            let presenter = UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .first
            // UIKit silently refuses to present over another sheet, and then nothing would reply
            guard let presenter, current == nil, presenter.presentedViewController == nil else {
                return done(nil)
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            let delegate = FolderPicker(done: done)
            picker.delegate = delegate
            picker.presentationController?.delegate = delegate
            current = delegate
            presenter.present(picker, animated: true)
        }

        func documentPicker(
            _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
        ) {
            finish(urls.first)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            finish(nil)
        }

        /// A swipe down dismisses the sheet without calling documentPickerWasCancelled.
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            finish(nil)
        }

        /// Replies once even if a dismissal reports itself twice.
        private func finish(_ url: URL?) {
            guard Self.current === self else { return }
            Self.current = nil
            done(url)
        }
    }
#endif
