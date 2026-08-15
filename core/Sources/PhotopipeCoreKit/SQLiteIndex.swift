import Foundation
import SQLite3

private let transientDestructor = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// One connection, no internal locking: callers must serialize their access.
public final class SQLiteIndex: @unchecked Sendable {
    public enum IndexError: Error {
        case open(String)
        case exec(String)
    }

    private var db: OpaquePointer?
    private let path: String

    private static let schemaVersion = 3

    public init(path: String) throws {
        self.path = path
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        do {
            try open()
        } catch {
            sqlite3_close(db)
            db = nil
            try? FileManager.default.removeItem(atPath: path)
            try open()
        }
    }

    deinit {
        sqlite3_close(db)
    }

    private func open() throws {
        guard sqlite3_open(path, &db) == SQLITE_OK else {
            throw IndexError.open(String(cString: sqlite3_errmsg(db)))
        }
        try exec("PRAGMA journal_mode = WAL")
        try exec(
            """
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                shoot TEXT NOT NULL,
                rel TEXT NOT NULL,
                ext TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime REAL NOT NULL,
                rating INTEGER NOT NULL DEFAULT 0,
                edit TEXT,
                width INTEGER NOT NULL DEFAULT 0,
                height INTEGER NOT NULL DEFAULT 0,
                enriched INTEGER NOT NULL DEFAULT 0,
                sidecar_mtime REAL NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS files_shoot ON files(shoot);
            """)
        let stored = try scalarInt("SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'schema'")
        if let stored, stored != Self.schemaVersion {
            sqlite3_close(db)
            db = nil
            try? FileManager.default.removeItem(atPath: path)
            try open()
            return
        }
        try exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '\(Self.schemaVersion)')")
        try exec("SELECT count(*) FROM files")
    }

    private func exec(_ sql: String) throws {
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &message) == SQLITE_OK else {
            let text = message.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(message)
            throw IndexError.exec(text)
        }
    }

    private func scalarInt(_ sql: String) throws -> Int? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw IndexError.exec(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return Int(sqlite3_column_int64(statement, 0))
    }

    public func save(root: String, filesByShoot: [String: [ImageFile]]) throws {
        try write {
            try exec("DELETE FROM files")
            try exec(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('root', '\(root.replacingOccurrences(of: "'", with: "''"))')"
            )
            try insert(filesByShoot)
        }
    }

    /// Folds a freshly enriched batch into the stored rows without touching the
    /// rest, so the next launch starts warm even if this one is interrupted.
    public func upsert(shoot: String, files: [ImageFile]) throws {
        guard !files.isEmpty else { return }
        try write { try insert([shoot: files]) }
    }

    private func write(_ body: () throws -> Void) throws {
        try exec("BEGIN")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    private func insert(_ filesByShoot: [String: [ImageFile]]) throws {
        var statement: OpaquePointer?
        let sql = """
            INSERT OR REPLACE INTO files
            (path, shoot, rel, ext, size, mtime, rating, edit, width, height, enriched,
             sidecar_mtime)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw IndexError.exec(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(statement) }
        let encoder = JSONEncoder()
        for (shoot, files) in filesByShoot {
            for file in files {
                sqlite3_reset(statement)
                sqlite3_bind_text(statement, 1, file.path, -1, transientDestructor)
                sqlite3_bind_text(statement, 2, shoot, -1, transientDestructor)
                sqlite3_bind_text(statement, 3, file.rel, -1, transientDestructor)
                sqlite3_bind_text(statement, 4, file.ext, -1, transientDestructor)
                sqlite3_bind_int64(statement, 5, file.size)
                sqlite3_bind_double(statement, 6, file.mtime)
                sqlite3_bind_int64(statement, 7, Int64(file.rating))
                // The overwhelming majority of photos carry no edit; storing
                // NULL for those keeps the index small on a big library.
                if file.edit == .identity {
                    sqlite3_bind_null(statement, 8)
                } else {
                    let json = String(decoding: try encoder.encode(file.edit), as: UTF8.self)
                    sqlite3_bind_text(statement, 8, json, -1, transientDestructor)
                }
                sqlite3_bind_int64(statement, 9, Int64(file.width))
                sqlite3_bind_int64(statement, 10, Int64(file.height))
                sqlite3_bind_int64(statement, 11, file.enriched ? 1 : 0)
                sqlite3_bind_double(statement, 12, file.sidecarMtime)
                guard sqlite3_step(statement) == SQLITE_DONE else {
                    throw IndexError.exec(String(cString: sqlite3_errmsg(db)))
                }
            }
        }
    }

    public func load() throws -> (root: String, filesByShoot: [String: [ImageFile]])? {
        var rootStatement: OpaquePointer?
        guard
            sqlite3_prepare_v2(
                db, "SELECT value FROM meta WHERE key = 'root'", -1, &rootStatement, nil) == SQLITE_OK
        else {
            throw IndexError.exec(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(rootStatement) }
        guard sqlite3_step(rootStatement) == SQLITE_ROW,
            let rootText = sqlite3_column_text(rootStatement, 0)
        else { return nil }
        let root = String(cString: rootText)

        var statement: OpaquePointer?
        let sql = """
            SELECT path, shoot, rel, ext, size, mtime, rating, edit, width, height, enriched,
                   sidecar_mtime
            FROM files
            """
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw IndexError.exec(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(statement) }

        let decoder = JSONDecoder()
        var filesByShoot: [String: [ImageFile]] = [:]
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let pathText = sqlite3_column_text(statement, 0),
                let shootText = sqlite3_column_text(statement, 1),
                let relText = sqlite3_column_text(statement, 2),
                let extText = sqlite3_column_text(statement, 3)
            else { continue }
            let edit = sqlite3_column_text(statement, 7).flatMap { json in
                try? decoder.decode(Edit.self, from: Data(String(cString: json).utf8))
            }
            let record = ImageFile(
                path: String(cString: pathText),
                rel: String(cString: relText),
                ext: String(cString: extText),
                size: sqlite3_column_int64(statement, 4),
                mtime: sqlite3_column_double(statement, 5),
                rating: Int(sqlite3_column_int64(statement, 6)),
                edit: edit ?? .identity,
                width: Int(sqlite3_column_int64(statement, 8)),
                height: Int(sqlite3_column_int64(statement, 9)),
                enriched: sqlite3_column_int64(statement, 10) == 1,
                sidecarMtime: sqlite3_column_double(statement, 11))
            filesByShoot[String(cString: shootText), default: []].append(record)
        }
        return (root, filesByShoot)
    }
}
