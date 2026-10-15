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

    // bump when the sidecar parser learns a tag, or stale rows get written back over it
    private static let schemaVersion = 6

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
            throw IndexError.open(errorMessage)
        }
        try exec("PRAGMA journal_mode = WAL")
        // A locked database is a reason to wait, not to conclude the file is
        // corrupt: the recovery path below deletes it, and that would throw away
        // every score ever computed.
        sqlite3_busy_timeout(db, 3000)
        try exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        let stored = try scalarInt("SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'schema'")
        // scores took minutes per shoot and survive a parser change; the files
        // table goes whole, since an older layout would not take today's rows
        if let stored, stored != Self.schemaVersion {
            try exec("DROP TABLE IF EXISTS files; DELETE FROM meta")
        }
        try exec(
            """
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
            CREATE TABLE IF NOT EXISTS scores (
                path TEXT PRIMARY KEY,
                score REAL,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                version INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS prints (
                path TEXT PRIMARY KEY,
                feature BLOB,
                captured REAL,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                version INTEGER NOT NULL
            );
            """)
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

    private var errorMessage: String { String(cString: sqlite3_errmsg(db)) }

    private func withStatement<T>(_ sql: String, _ body: (OpaquePointer?) throws -> T) throws -> T {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw IndexError.exec(errorMessage)
        }
        defer { sqlite3_finalize(statement) }
        return try body(statement)
    }

    private func scalarInt(_ sql: String) throws -> Int? {
        try withStatement(sql) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
            return Int(sqlite3_column_int64(statement, 0))
        }
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
        let sql = """
            INSERT OR REPLACE INTO files
            (path, shoot, rel, ext, size, mtime, rating, edit, width, height, enriched,
             sidecar_mtime)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """
        try withStatement(sql) { statement in
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
                    // a row another build writes carries its own version, so it reads as unparsed
                    sqlite3_bind_int64(statement, 11, file.enriched ? Int64(Self.schemaVersion) : 0)
                    sqlite3_bind_double(statement, 12, file.sidecarMtime)
                    guard sqlite3_step(statement) == SQLITE_DONE else {
                        throw IndexError.exec(errorMessage)
                    }
                }
            }
        }
    }

    public func load() throws -> (root: String, filesByShoot: [String: [ImageFile]])? {
        let root = try withStatement("SELECT value FROM meta WHERE key = 'root'") { statement in
            sqlite3_step(statement) == SQLITE_ROW
                ? sqlite3_column_text(statement, 0).map { String(cString: $0) } : nil
        }
        guard let root else { return nil }

        let sql = """
            SELECT path, shoot, rel, ext, size, mtime, rating, edit, width, height, enriched,
                   sidecar_mtime
            FROM files
            """
        return try withStatement(sql) { statement in
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
                    enriched: sqlite3_column_int64(statement, 10) == Self.schemaVersion,
                    sidecarMtime: sqlite3_column_double(statement, 11))
                filesByShoot[String(cString: shootText), default: []].append(record)
            }
            return (root, filesByShoot)
        }
    }

    /// `root` limits the load to one library; the table holds every library ever opened.
    public func loadScores(under root: String? = nil) throws -> [String: Scorer.Row] {
        try loadRows("score", from: "scores", under: root) { columnDouble($0, 1) }
    }

    public func saveScores(_ rows: [(String, Scorer.Row)]) throws {
        try saveRows(
            "INSERT OR REPLACE INTO scores (path, score, mtime, size, version) VALUES (?,?,?,?,?)",
            rows
        ) { statement, score in bindDouble(statement, 2, score) }
    }

    public func loadPrints(under root: String? = nil) throws -> [String: Printer.Row] {
        try loadRows("feature, captured", from: "prints", under: root) { statement in
            guard let blob = sqlite3_column_blob(statement, 1) else { return nil }
            let bytes = UnsafeRawBufferPointer(
                start: blob, count: Int(sqlite3_column_bytes(statement, 1)))
            // sqlite promises no alignment for a blob, so copy rather than rebind
            var feature = [Float](repeating: 0, count: bytes.count / MemoryLayout<Float>.stride)
            feature.withUnsafeMutableBytes {
                $0.copyMemory(from: UnsafeRawBufferPointer(rebasing: bytes[..<$0.count]))
            }
            return Print(feature: feature, captured: columnDouble(statement, 2))
        }
    }

    public func savePrints(_ rows: [(String, Printer.Row)]) throws {
        try saveRows(
            "INSERT OR REPLACE INTO prints (path, feature, captured, mtime, size, version) VALUES (?,?,?,?,?,?)",
            rows
        ) { statement, print in
            if let print {
                _ = print.feature.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(
                        statement, 2, bytes.baseAddress, Int32(bytes.count), transientDestructor)
                }
            } else {
                sqlite3_bind_null(statement, 2)
            }
            bindDouble(statement, 3, print?.captured)
        }
    }

    private func columnDouble(_ statement: OpaquePointer?, _ column: Int32) -> Double? {
        sqlite3_column_type(statement, column) == SQLITE_NULL
            ? nil : sqlite3_column_double(statement, column)
    }

    private func bindDouble(_ statement: OpaquePointer?, _ index: Int32, _ value: Double?) {
        if let value {
            sqlite3_bind_double(statement, index, value)
        } else {
            sqlite3_bind_null(statement, index)
        }
    }

    /// Selects the path, `columns` for `value` to read from column 1 on, then the row's stamps.
    private func loadRows<Value>(
        _ columns: String, from table: String, under root: String?,
        value: (OpaquePointer?) -> Value?
    ) throws -> [String: AnalysisRow<Value>] {
        let scope = root == nil ? "" : " WHERE path > ? AND path < ?"
        let sql = "SELECT path, \(columns), mtime, size, version FROM \(table)\(scope)"
        return try withStatement(sql) { statement in
            if let root {
                // every path under the root sorts between "root/" and "root0"
                sqlite3_bind_text(statement, 1, root + "/", -1, transientDestructor)
                sqlite3_bind_text(statement, 2, root + "0", -1, transientDestructor)
            }
            let stamps = sqlite3_column_count(statement) - 3
            var rows: [String: AnalysisRow<Value>] = [:]
            while sqlite3_step(statement) == SQLITE_ROW {
                guard let pathText = sqlite3_column_text(statement, 0) else { continue }
                rows[String(cString: pathText)] = AnalysisRow(
                    value: value(statement),
                    mtime: sqlite3_column_double(statement, stamps),
                    size: sqlite3_column_int64(statement, stamps + 1),
                    version: Int(sqlite3_column_int64(statement, stamps + 2)))
            }
            return rows
        }
    }

    /// `sql` binds the path first and the row's mtime, size and version last; `bind` fills in
    /// whatever sits between.
    private func saveRows<Value>(
        _ sql: String, _ rows: [(String, AnalysisRow<Value>)],
        bind: (OpaquePointer?, Value?) -> Void
    ) throws {
        guard !rows.isEmpty else { return }
        try write {
            try withStatement(sql) { statement in
                let last = sqlite3_bind_parameter_count(statement)
                for (path, row) in rows {
                    sqlite3_reset(statement)
                    sqlite3_bind_text(statement, 1, path, -1, transientDestructor)
                    bind(statement, row.value)
                    sqlite3_bind_double(statement, last - 2, row.mtime)
                    sqlite3_bind_int64(statement, last - 1, row.size)
                    sqlite3_bind_int64(statement, last, Int64(row.version))
                    guard sqlite3_step(statement) == SQLITE_DONE else {
                        throw IndexError.exec(errorMessage)
                    }
                }
            }
        }
    }
}
