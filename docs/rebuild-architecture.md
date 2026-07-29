# Photopipe Rebuild — Target Architecture

Companion to [`functional-spec.md`](./functional-spec.md) (what the app does). This doc defines *how* the rebuild should work.

## Requirements (from the rebuild goals)

1. **Disk is the source of truth** and remains directly accessible over the network (SMB/NFS share). The app must tolerate external mutation — PureRAW, Lightroom, Finder — at any time. Treat the tree like blob storage the app doesn't exclusively own.
2. **A database indexes the files** for fast queries and UI state.
3. **Metadata lives inside the files themselves** (ratings etc.) so the folder is self-describing and syncs/portably survives copies, backups, and other tools.
4. Sync need not be real-time, but changes (local or external) should surface in the UI within a few seconds.
5. Stack: **Next.js (App Router) + Tailwind + TypeScript**, still self-hosted via Docker.

## 1. High-level shape

```
                      ┌──────────────────────────────────────────┐
  SMB/NFS clients ──▶ │  Disk: /data/camera  (source of truth)   │
  PureRAW, LR, Finder │  images + embedded XMP + shoot manifest  │
                      └───────▲──────────────────┬───────────────┘
                              │ writes           │ fs events + periodic scan
                      ┌───────┴──────────────────▼───────────────┐
                      │  Sync engine (in the Next.js server)     │
                      │  watcher → reconciler → SQLite index     │
                      │  write-through: UI edits → XMP → index   │
                      └───────▲──────────────────┬───────────────┘
                              │ mutations        │ invalidation events (SSE)
                      ┌───────┴──────────────────▼───────────────┐
                      │  Next.js app  (RSC reads from SQLite,    │
                      │  route handlers for mutations/streams)   │
                      └──────────────────────────────────────────┘
```

Three layers, one direction of authority: **disk > index > UI cache**. The SQLite DB is disposable — deleting it and running a full scan reproduces all state, because everything durable lives on disk (image files, embedded/sidecar XMP, one manifest per shoot).

## 2. On-disk format

Simplified folder contract — `YYYY-MM-DD_slug/` with:

```
raw/        camera originals (.arw + .xmp sidecars)
denoised/   ALL working DNGs (PureRAW output stays here through rating & curation)
exports/    final edited images
.thumbs/    regenerable cache
```

The old `rated/` and `selects/` directories are **gone**. With metadata in the files, those stages stop being *places* and become *queries*:

- **rated** = `xmp:Rating` is set (1–5)
- **selects** = `xmp:Label == "Select"` — a standard XMP field (Lightroom/Bridge show it as a color/text label), toggled in the UI, written into the file like the rating. This preserves *manual* curation: promoting ≥4★ is just a bulk "set label" action, and individual files can be added/removed from selects regardless of rating.

Files never move during rate/curate; only `raw → denoised` (external PureRAW) and `→ exports` (external edit + upload) are physical transitions. Nothing is lost for network-share browsing because the website's download can materialize these views (see §6a). Additions:

### 2.1 Per-image metadata → XMP

| File type | Where the metadata goes | Why |
| --- | --- | --- |
| `.dng` (denoised/) | **Embedded XMP packet** in the DNG | DNG is a TIFF-based container designed for this; Lightroom/Bridge/Photo Mechanic interoperate |
| `.arw` (raw) | **`.xmp` sidecar** next to the file | Writing inside proprietary raw is unsafe; sidecars are the Adobe-standard convention (the current app already treats `.xmp` as a raw companion) |
| exports (`.jpg` etc.) | Embedded XMP | trivial |

Fields (all standard, no invention needed):

- `xmp:Rating` (0–5) — the star rating. This replaces the Convex ratings table *as truth*.
- `xmp:Label` — `"Select"` marks curated selects (absent otherwise). Also usable for future color-label workflows.
- A small custom namespace (`photopipe:`) only if we need app-specific flags later; start without it.

Tooling: **exiftool** (invoked from Node, or via a maintained wrapper). It is the only battle-tested option for safe in-place XMP writes across DNG/JPEG/TIFF and sidecar handling. Bonus: `exiftool -b -PreviewImage`/`-JpgFromRaw` extracts embedded previews from DNG/ARW robustly, replacing the current hand-rolled JPEG byte-scan in the thumbnailer.

### 2.2 Per-shoot metadata → manifest file

Shoot-level data has no image to live in, so it goes in a JSON manifest inside the shoot folder (restoring the pre-Convex pattern):

```
2026-04-10_spring-concert/.photopipe.json
{ "version": 2, "name": "Spring Concert", "date": "2026-04-10",
  "createdAt": "...", "algorithm": "DeepPRIME 3", "notes": "...",
  "rawCount": 214 }
```

Ratings do **not** go in the manifest (they're in the files); the manifest never becomes a second ratings store.

### 2.3 Derived data → `.thumbs/`

Thumbnail/preview cache stays inside the shoot (hidden dir), regenerable, excluded from listings and ZIPs. Safe to delete anytime.

## 3. The index database

**SQLite** in the app's data volume (e.g. `/data/index.db`), via Drizzle ORM + better-sqlite3 (synchronous, single-process — matches a single Next.js server). No cloud dependency; the self-hosted box is self-contained.

```sql
shoots(id, folder_name UNIQUE, name, date, created_at,
       algorithm, notes, raw_count,
       last_scanned_at, manifest_mtime)

files(id, shoot_id, stage,          -- raw|denoised|exports
      file_name, size_bytes, mtime,
      rating,                        -- mirrored from XMP, null = unrated
      label,                         -- mirrored from XMP ('Select' | null)
      xmp_mtime,                     -- sidecar or embedded-source mtime we last read
      UNIQUE(shoot_id, stage, file_name))

pending_writes(id, path, expected_mtime, created_at)  -- echo suppression, see §4.3
```

Rules:

- Reads for the UI **always** come from SQLite (fast, sortable, filterable — fixes the "stat every file per request" pattern).
- The DB row's `rating` is a *mirror* of the file's XMP. On conflict, **the file wins** (see §4.4).
- A schema version + "rebuild index" admin action (drop + full rescan) is a first-class feature, not a recovery hack.

## 4. Sync engine

One module, running inside the Next.js server process (instrumented to start once via `instrumentation.ts`). Replaces all three of the old realtime mechanisms.

### 4.1 Change detection

- **fs watcher** (chokidar) on the camera root. Note: because the disk is *local to the server* and shared **out** via SMB/NFS, writes made by network clients land through the server's filesystem and do emit local fs events — the watcher covers external edits too. (If the tree were instead a mount *from* elsewhere, events would be unreliable and polling would be primary; the design below degrades to that gracefully.)
- **Debounced dirty-marking**: events mark `(shoot, stage)` dirty; a reconciler drains the dirty set after ~1–2 s of quiet. Bulk PureRAW output → one scan, not 200.
- **Periodic full scan** (e.g. every 5 min, and on boot) as the safety net for missed events, plus stat-based file-stability detection (size unchanged across two passes) to avoid indexing half-written PureRAW output — same heuristic as today, but inside the reconciler instead of a bespoke SSE watcher.

### 4.2 Reconciler (scan of a dirty shoot/stage)

1. `readdir` + `stat` the stage dir; diff against `files` rows (name, size, mtime).
2. New/changed file → upsert row; if image mtime or sidecar mtime changed and it's not an echo of our own write → re-read `xmp:Rating` (exiftool batch call for all changed files at once) → update `rating`.
3. Missing file → delete row (and its thumbs).
4. Manifest changed → update shoot row. Shoot folder missing → remove shoot (rows only, never touches disk).
5. Emit one invalidation event: `{shootId, stages: [...]}`.

### 4.3 Write path (UI edits)

Write-through, disk first — the DB is never ahead of the disk except transiently:

```
rate(file, 4) → exiftool writes XMP (embedded or sidecar)
             → record pending_write(path, new mtime)     [echo suppression]
             → update SQLite row
             → emit invalidation event
```

Rating and label writes are debounced/batched per shoot (the current 500 ms client batching maps to one exiftool invocation for N files — exiftool takes many files per call). Rating no longer moves files; "promote to selects" is a batched label write. The only physical moves left are uploads and deletions (plus `rename()` if a future feature needs it — XMP travels inside the file either way). Shoot metadata edits write the manifest. Every mutation ends by marking dirty + emitting, so the UI converges even if a step partially failed.

Status derivation adapts to the query model: `exported` (exports non-empty) → `curating` (any `label='Select'`) → `rating` (any rating set) → `denoising`/`ready`/`uploading`/`empty` as before.

### 4.4 Conflict rule

Last writer wins, and the *disk* is the arbiter: if an external tool (e.g. Lightroom over the share) changed a file's XMP after our last read, the reconciler overwrites the DB mirror with the file's value. No merge logic — single-user tool, standard field, simplest correct behavior.

## 5. Freshness to the UI ("quickly, not real-time")

One channel, one payload type:

- `GET /api/events` — SSE stream of invalidation messages `{shootId, stages}` (heartbeat every 25 s). No data rides the stream.
- Client: React Query (TanStack) holds all reads; an SSE listener maps invalidations to `queryClient.invalidateQueries(...)`. Fallback when SSE drops: refetch-on-focus + 15 s polling.

This yields sub-second UI updates for own edits (optimistic + invalidation), and "within a couple seconds" for external changes (watcher debounce + invalidation) — matching the stated requirement without live-query infrastructure. The denoise monitor becomes a plain consumer of this: progress = `files` count for the `denoised` stage, updating as the reconciler indexes stable files; the idle→"complete" notification is a client-side timer on top.

## 6. Next.js application

- **App Router**, RSC for reads: `/(dashboard)/page.tsx` (shoot list), `/shoot/[name]/page.tsx` (detail) — server components query SQLite directly; client components (rating view, galleries, upload) hydrate via React Query with initial data from the server.
- **Route handlers** replace the SvelteKit endpoints ~1:1 (see functional-spec §4): shoots CRUD, upload (switch to **streamed** multipart writing to a temp file + atomic rename — kills the in-memory buffering), rate/label mutations (replacing move/rate/selects), ZIP download (Archiver streams fine in a Node route handler), thumbs (Sharp + exiftool preview extraction, same `.thumbs/` cache + in-flight dedup), events (SSE).

### 6a. Downloads with virtual folders

Since `rated/` and `selects/` no longer exist on disk, the ZIP endpoint serves them as **query-backed virtual folders**, so everything downloadable in the old app stays downloadable through the website:

```
GET /api/shoots/[name]/download
  ?include=raw,denoised,rated,selects,exports   # physical + virtual names mixed freely
  &minRating=4                                   # optional extra filter on rating-based sets
  &flat=true|false
```

- `raw`, `denoised`, `exports` → the physical directories (as today).
- `rated` → files from `denoised/` where `rating IS NOT NULL` (index query).
- `selects` → files from `denoised/` where `label = 'Select'`.
- `minRating=n` → applies to `rated`/`selects` sets (the old unimplemented param, now real).
- With structure preserved, virtual sets materialize as `rated/` / `selects/` folders **inside the ZIP**, matching the old archive layout; `flat` merges everything. If `denoised` is requested alongside a virtual set, overlapping files appear once per requested grouping (explicit, predictable).

The download dialog keeps its five checkboxes (with live counts/sizes now served from the index) plus an optional min-rating picker — the UX doesn't regress just because the disk layout got simpler.
- **Validation**: Zod schemas shared between route handlers and client fetchers; keep the `PhotopipeError` code→status mapping.
- **Tailwind** for all styling; port the existing visual language (dark, dense, status badges, filter pills) as components: `RatingView` (fullscreen culler — keyboard map, filters, filmstrip, debounced saves, zoom, and the WebGL2 exposure preview canvas port over intact), `RatedGallery`, `DenoiseProgress`, dialogs.
- **Runtime**: Node runtime only (Sharp, exiftool, SQLite — no edge). Single Docker container: Next standalone output + `vips` + `exiftool` + the two volumes (`/data/camera`, `/data/index.db`).

## 7. What this deletes from the old design

| Old | Replaced by |
| --- | --- |
| Convex (cloud DB, `PUBLIC_CONVEX_URL`) | local SQLite index + XMP in files |
| 3 realtime channels (Convex live query, ratings SSE, watch SSE) | 1 SSE invalidation stream + React Query |
| 2 s polling denoise watcher singleton | fs-event reconciler (denoise progress is just index updates) |
| Client-side direct DB mutations bypassing the API | all writes through route handlers → sync engine |
| Hand-rolled JPEG marker scan for DNG previews | exiftool preview extraction |
| Ratings truth split across 3 stores, silent 3★ default | XMP is truth; unrated is null, no defaulting |
| In-memory whole-file upload buffering | streamed upload → temp file → atomic rename |

## 8. Decisions taken (defaults, revisit if needed)

- **exiftool as a runtime dependency** — the one new system dep; alternatives (exiv2 bindings, pure-JS XMP) are all weaker on safe in-place DNG writes.
- **Sidecars for ARW, embedded for DNG/JPEG** — mixed mode, standard practice.
- **SQLite over Postgres** — single-process self-hosted app; nothing here needs a server DB.
- **No auth again** (LAN/reverse-proxy), but structure route handlers behind a single middleware so basic auth can be added in one place.
- **`rated`/`selects` are queries, not folders** — collapsed into `denoised/` with XMP rating/label as the markers. Accepted on the condition that the website's download still offers them as selectable sets, which §6a guarantees via virtual folders in the ZIP. (On the raw share you see one `denoised/` dir; any XMP-aware browser — Lightroom, Bridge — can still filter by rating/label there.)
- **Migration from the current app**: one-time script — export Convex ratings, stamp them into the DNGs as `xmp:Rating`; move `rated/*` and `selects/*` back into `denoised/`, writing `xmp:Label='Select'` on the former selects; delete the empty dirs; drop Convex.
