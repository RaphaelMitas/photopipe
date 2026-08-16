import Foundation
import Testing

@testable import PhotopipeCoreKit

private func plan(_ count: Int, in dir: URL, staging: URL? = nil) -> Exporter.Plan {
    let base = staging ?? dir
    let items = (0..<count).map { index in
        Exporter.Plan.Item(
            image: ImageFile(
                path: "/library/DSC0000\(index).jpg", rel: "DSC0000\(index).jpg", ext: "jpg",
                size: 1, mtime: 1),
            target: base.appendingPathComponent("DSC0000\(index).jpg"))
    }
    return Exporter.Plan(items: items, destination: dir.path, staging: staging)
}

private func waitUntilIdle(
    _ exporter: Exporter, _ id: String, sourceLocation: SourceLocation = #_sourceLocation
) -> Exporter.Progress {
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline {
        guard let progress = exporter.progress(id: id) else { break }
        if !progress.running { return progress }
        Thread.sleep(forTimeInterval: 0.01)
    }
    Issue.record("export \(id) never finished", sourceLocation: sourceLocation)
    return .init(
        id: id, total: 0, destination: "", done: 0, failed: 0, running: true, cancelled: false,
        error: nil)
}

@Test func startReturnsBeforeAnyFileIsWritten() throws {
    let dir = scratchDir("exporter")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    // Held until the assertions are done, standing in for the minutes a
    // few hundred full-resolution renders take.
    let gate = DispatchSemaphore(value: 0)
    let exporter = Exporter()
    let began = Date()
    let job = exporter.start(plan: plan(3, in: dir)) { _, target in
        gate.wait()
        try Data("photo".utf8).write(to: target)
    }

    // The client gives up on a request after ten seconds.
    #expect(Date().timeIntervalSince(began) < 1)
    #expect(job.running)
    #expect(job.total == 3)
    #expect(exporter.progress(id: job.id)?.done == 0)

    for _ in 0..<3 { gate.signal() }
    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.done == 3)
    #expect(finished.error == nil)
}

@Test func oneUnwritableFileDoesNotLoseTheRest() throws {
    let dir = scratchDir("exporter")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let exporter = Exporter()
    let job = exporter.start(plan: plan(4, in: dir)) { image, target in
        guard image.rel != "DSC00002.jpg" else { throw Renderer.RenderError.unreadable(image.path) }
        try Data("photo".utf8).write(to: target)
    }

    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.done == 3)
    #expect(finished.failed == 1)
    #expect(finished.error == nil)
    #expect(
        try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted() == [
            "DSC00000.jpg", "DSC00001.jpg", "DSC00003.jpg",
        ])
}

@Test func aFailedDeliveryReportsWhyRatherThanClaimingSuccess() throws {
    let dir = scratchDir("exporter")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let exporter = Exporter()
    let job = exporter.start(plan: plan(2, in: dir)) { image, _ in
        throw Renderer.RenderError.unreadable(image.path)
    }

    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.done == 0)
    #expect(finished.failed == 2)
    #expect(finished.error != nil)
}

@Test func cancelStopsTheQueueAndKeepsWhatLanded() throws {
    let dir = scratchDir("exporter")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    // Six files, four writers: the last two are still queued when cancel lands.
    let gate = DispatchSemaphore(value: 0)
    let exporter = Exporter()
    let job = exporter.start(plan: plan(6, in: dir)) { _, target in
        gate.wait()
        try Data("photo".utf8).write(to: target)
    }
    #expect(exporter.cancel(id: job.id) != nil)
    for _ in 0..<6 { gate.signal() }

    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.cancelled)
    // A render cannot be interrupted mid-file, so the four already under way
    // finish and are kept; the queue behind them is dropped.
    #expect(finished.done == 4)
    #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path).count == 4)
}

@Test func anArchiveThatCannotBeBuiltIsReportedAsFailedNotDelivered() throws {
    let dir = scratchDir("exporter")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    // Staging is never created, so zip has nothing to archive and fails.
    let staging = dir.appendingPathComponent("staging")
    let archive = dir.appendingPathComponent("delivery.zip")
    let exporter = Exporter()
    let job = exporter.start(
        plan: Exporter.Plan(
            items: plan(2, in: archive, staging: staging).items,
            destination: archive.path, staging: staging)
    ) { _, _ in }

    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.done == 0, "the files went nowhere the user can reach")
    #expect(finished.error != nil)
    #expect(!FileManager.default.fileExists(atPath: archive.path))
}

@Test func cancellingAZipLeavesNoArchiveAndNoStagingDirectory() throws {
    let dir = scratchDir("exporter")
    let staging = dir.appendingPathComponent("staging")
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let archive = dir.appendingPathComponent("delivery.zip")
    let gate = DispatchSemaphore(value: 0)
    let exporter = Exporter()
    let job = exporter.start(
        plan: Exporter.Plan(
            items: plan(2, in: archive, staging: staging).items,
            destination: archive.path, staging: staging)
    ) { _, target in
        gate.wait()
        try Data("photo".utf8).write(to: target)
    }
    _ = exporter.cancel(id: job.id)
    for _ in 0..<2 { gate.signal() }

    let finished = waitUntilIdle(exporter, job.id)
    #expect(finished.cancelled)
    // Staging is deleted with everything in it, so no count here describes a
    // file anyone can open.
    #expect(finished.done == 0)
    #expect(finished.failed == 0)
    let fm = FileManager.default
    #expect(!fm.fileExists(atPath: archive.path), "a half-filled archive is worse than none")
    #expect(!fm.fileExists(atPath: staging.path))
}
