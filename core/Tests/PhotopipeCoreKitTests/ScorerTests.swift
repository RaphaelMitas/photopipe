import Foundation
import Testing

@testable import PhotopipeCoreKit

private func waitForPass(_ scorer: Scorer, shoot: String, files: [ImageFile]) async throws {
    for _ in 0..<200 {
        if !scorer.progress(shoot: shoot, files: files).running { return }
        try await Task.sleep(for: .milliseconds(50))
    }
    Issue.record("scoring pass never finished")
}

/// Wires a scorer to an index the way LibraryService does, minus the queue hop
/// so a finished pass has already been written by the time a test looks.
private func attach(_ scorer: Scorer, to index: SQLiteIndex) {
    scorer.use(cache: (try? index.loadScores()) ?? [:]) { rows in
        try? index.saveScores(rows)
    }
}

@Test func scorerAnswersEveryFileAndPersistsAcrossInstances() async throws {
    let indexPath = tempFile("index.sqlite")
    let (file, url) = try makePNG()
    defer {
        try? FileManager.default.removeItem(atPath: indexPath)
        try? FileManager.default.removeItem(at: url)
    }

    let scorer = Scorer()
    attach(scorer, to: try SQLiteIndex(path: indexPath))
    let started = scorer.start(shoot: "s", files: [file])
    #expect(started.total == 1)
    try await waitForPass(scorer, shoot: "s", files: [file])

    let score = try #require(scorer.scores(for: [file])[file.path])
    #expect(score >= -1 && score <= 1)

    let reopened = Scorer()
    attach(reopened, to: try SQLiteIndex(path: indexPath))
    #expect(reopened.scores(for: [file])[file.path] == score)
    #expect(reopened.start(shoot: "s", files: [file]).running == false)
}

@Test func cancellingAPassNeverWritesAFileOffAsUnrateable() async throws {
    let indexPath = tempFile("index.sqlite")
    var files: [ImageFile] = []
    var urls: [URL] = []
    for _ in 0..<40 {
        let (file, url) = try makePNG()
        files.append(file)
        urls.append(url)
    }
    defer {
        try? FileManager.default.removeItem(atPath: indexPath)
        for url in urls { try? FileManager.default.removeItem(at: url) }
    }

    let index = try SQLiteIndex(path: indexPath)
    let scorer = Scorer()
    attach(scorer, to: index)
    scorer.start(shoot: "s", files: files)
    try await Task.sleep(for: .milliseconds(20))
    // Switching libraries cancels the pass with reads still in flight. Vision
    // reports those the same way it reports a file it cannot open.
    scorer.use(cache: [:]) { _ in }
    try await Task.sleep(for: .milliseconds(300))

    let stored = try index.loadScores()
    #expect(stored.values.allSatisfy { $0.score != nil })
}

@Test func editingTheFileDropsItsCachedScore() async throws {
    let indexPath = tempFile("index.sqlite")
    let (file, url) = try makePNG()
    defer {
        try? FileManager.default.removeItem(atPath: indexPath)
        try? FileManager.default.removeItem(at: url)
    }

    let scorer = Scorer()
    attach(scorer, to: try SQLiteIndex(path: indexPath))
    scorer.start(shoot: "s", files: [file])
    try await waitForPass(scorer, shoot: "s", files: [file])
    #expect(scorer.scores(for: [file]).count == 1)

    let (replacement, replacementURL) = try makePNG(width: 96, height: 72)
    defer { try? FileManager.default.removeItem(at: replacementURL) }
    try FileManager.default.removeItem(at: url)
    try FileManager.default.copyItem(at: replacementURL, to: url)
    let changed = try image(url)
    #expect(changed.size != file.size)
    #expect(replacement.path != changed.path)

    #expect(scorer.scores(for: [changed]).isEmpty)
    #expect(scorer.progress(shoot: "s", files: [changed]).done == 0)
}

@Test func aFileVisionCannotReadStillCompletesThePass() async throws {
    let indexPath = tempFile("index.sqlite")
    let brokenPath = tempFile("broken.png")
    try Data("not an image".utf8).write(to: URL(fileURLWithPath: brokenPath))
    defer {
        try? FileManager.default.removeItem(atPath: indexPath)
        try? FileManager.default.removeItem(atPath: brokenPath)
    }
    let broken = try image(URL(fileURLWithPath: brokenPath))

    let scorer = Scorer()
    attach(scorer, to: try SQLiteIndex(path: indexPath))
    scorer.start(shoot: "s", files: [broken])
    try await waitForPass(scorer, shoot: "s", files: [broken])

    let progress = scorer.progress(shoot: "s", files: [broken])
    #expect(progress.done == progress.total)
    #expect(progress.running == false)
    #expect(scorer.scores(for: [broken]).isEmpty)
    #expect(scorer.start(shoot: "s", files: [broken]).running == false)
}
