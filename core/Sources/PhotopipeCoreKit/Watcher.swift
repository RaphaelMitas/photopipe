import CoreServices
import Foundation

/// FSEvents wrapper: fires `onChange` on the given queue for any mutation
/// under `path`. Coalescing/debouncing is the caller's job.
///
/// The stream's context holds a small retained trampoline object rather than
/// `self`: FSEvents retains it via the context's retain/release callbacks and
/// drops it only after `FSEventStreamInvalidate` has quiesced in-flight
/// callbacks, so deallocating the `Watcher` mid-callback can't leave the
/// stream dereferencing freed memory.
public final class Watcher {
    private final class Trampoline {
        let onChange: () -> Void
        init(_ onChange: @escaping () -> Void) { self.onChange = onChange }
    }

    private var stream: FSEventStreamRef?

    public init?(path: String, queue: DispatchQueue, onChange: @escaping () -> Void) {
        let trampoline = Trampoline(onChange)

        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            Unmanaged<Trampoline>.fromOpaque(info).takeUnretainedValue().onChange()
        }
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(trampoline).toOpaque(),
            retain: { info in
                guard let info else { return nil }
                _ = Unmanaged<Trampoline>.fromOpaque(info).retain()
                return UnsafeRawPointer(info)
            },
            release: { info in
                guard let info else { return }
                Unmanaged<Trampoline>.fromOpaque(info).release()
            },
            copyDescription: nil)
        guard
            let stream = FSEventStreamCreate(
                nil, callback, &context,
                [path] as CFArray,
                FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
                0.3,
                UInt32(kFSEventStreamCreateFlagNone))
        else { return nil }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    deinit {
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
    }
}
