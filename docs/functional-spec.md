# Photopipe — Functional Specification

This document describes everything the current Photopipe app does, written as a rebuild spec. It covers the domain model, every feature and its exact behavior, the API surface, the realtime mechanisms, and — importantly for a rebuild — the architectural weak points that motivated it.

Source snapshot: `main` @ 68f2779 (July 2026). ~9k lines: SvelteKit 2 / Svelte 5 (runes), adapter-node, Sharp, Archiver, Convex, Zod, Docker.

---

## 1. Purpose

Photopipe is a self-hosted, single-user (no auth) web app that manages the lifecycle of a camera shoot through a fixed pipeline:

```
upload raw ARWs → denoise externally (DxO PureRAW) → rate DNGs (1–5★)
→ promote favorites to selects → edit externally → upload exports → download/archive
```

The denoising and editing steps happen **outside** the app on the host machine (PureRAW, Lightroom, etc.). Photopipe's job is to organize files, watch for the results of those external steps, and provide a fast culling/rating UI.

## 2. Domain model

### 2.1 Shoot

The unit of work. A shoot is a directory on disk plus a metadata record.

- **Folder naming**: `YYYY-MM-DD_slug-name` (regex `^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$`). The slug is derived from a human name ("Spring Concert" → `spring-concert`; lowercase, spaces→hyphens, strip non-alphanumerics, collapse/trim hyphens). Display name is recovered by replacing hyphens with spaces.
- **Subdirectories** (all created on shoot creation, `rated/` and `selects/` also lazily on read):

| Dir         | Contents             | Allowed extensions                                 |
| ----------- | -------------------- | -------------------------------------------------- |
| `raw/`      | camera originals     | `.arw` (delete also allows `.xmp` sidecars)        |
| `denoised/` | PureRAW output       | `.dng`                                             |
| `rated/`    | rated DNGs           | `.dng`                                             |
| `selects/`  | curated keepers      | `.dng`                                             |
| `exports/`  | final edited images  | `.jpg .jpeg .png .tif .tiff .webp .dng`            |
| `.thumbs/`  | thumbnail/preview cache | generated `.webp` (never listed as content)     |

Directories that don't match the folder-name pattern are ignored entirely (legacy folders coexist safely in the camera dir).

### 2.2 Metadata (currently in Convex cloud DB)

Per shoot: `folderName` (unique key), `name`, `date`, `createdAt`, `algorithm` (`'DeepPRIME 3' | 'DeepPRIME XD3' | null`), `notes` (string), `rawCount` (number|null — snapshot of how many ARWs were uploaded, used as the denoise target).

Per rating: `(shootId, fileName) → rating 1–5`, unique per file.

The filesystem is the source of truth for *files*; Convex is the source of truth for *ratings and shoot metadata*. (An earlier iteration stored metadata in a `.photopipe.json` per shoot — the README still says so.) Shoots discovered on disk that have no Convex record are lazily upserted on first listing/read.

### 2.3 Status (derived, never stored)

First match wins:

1. `exported` — any file in `exports/`
2. `curating` — any file in `selects/`
3. `rating` — any file in `rated/`
4. `denoising` — DNGs exist but fewer than `metadata.rawCount`
5. `ready` — DNGs exist (count ≥ rawCount, or rawCount unknown)
6. `uploading` — only ARWs exist
7. `empty` — nothing

### 2.4 Constants

- Denoise time estimates (per file, M4 Mac Mini): DeepPRIME 3 = 24 s, DeepPRIME XD3 = 54 s. Used for ETA display.
- Canonical PureRAW settings shown to the user: output "Hi-Fi Compressed DNG", lens sharpness High, optical corrections all ON, dust removal ON. Convention: XD3 for hero shots, DeepPRIME 3 for bulk.

## 3. Features

### 3.1 Dashboard (`/`)

Lists all shoots (newest date first) as cards: display name, formatted date, status badge, per-stage counts (raw/DNG/rated/selects/exports), total size. Listing errors degrade to an empty list (logged server-side). Card links to the shoot page.

### 3.2 New shoot (`/new`)

Client-side wizard: name + date (defaults today) + drag-and-drop/browse ARW files (non-`.arw` silently filtered, duplicates by filename skipped). Shows live folder-name preview. On submit:

1. `POST /api/shoots` creates the folder tree + Convex record (409 if exists).
2. Uploads files 3-at-a-time (`Promise.allSettled` batches), tracking per-file progress, bytes, and failures.
3. `PATCH /api/upload/[name]` finalizes: recounts ARWs on disk and stores `rawCount` in metadata.
4. Done screen links to the shoot.

There is also a server-side form action (progressive enhancement path) that creates a shoot without files.

### 3.3 Shoot page (`/shoot/[name]`)

The core screen. A 5-stage tab bar (Raw / Denoised / Rate / Selects / Export) with per-stage counts; the initially selected tab is inferred from status (exported→Export, curating→Selects, rating→Rate, ready|denoising→Denoised, else Raw). Header shows name, date, folder name, status badge, and buttons for Settings and Download dialogs. Contextual "next action" CTA banners guide the user to the next pipeline step (e.g. "Start Rating", "Move ≥4★ to Selects").

**Raw tab** — upload widget (target folder selectable: raw/denoised/exports; extension allowlist per folder enforced client- and server-side; drag-drop with rejected-file warning; 3-at-a-time batched upload with progress bar; finalize PATCH afterwards). Raw file list with per-file and delete-all actions. "Cleanup" card compares ARW count vs DNG count (✓ match / mismatch warning) and offers deleting all ARWs to reclaim space (shows bytes to free).

**Denoised tab** — PureRAW instruction card (host-side input/output paths built from `CAMERA_HOST_BASE`, plus the canonical settings table); live Denoise Monitor (see 3.4); DNG file list with delete actions; "Move rated (n)" button that moves any DNGs which already have a live rating into `rated/`.

**Rate tab** — CTA to open the fullscreen Rating View over `denoised/`; "Move ≥4★ to Selects" bulk CTA (shown when there are rated files and no selects yet); Rated gallery (see 3.6) with a rating filter bar (All / ≥ = ≤ ×1–5★) and delete-all.

**Selects tab** — same gallery/filter UI over `selects/`, with move-back-to-rated support; empty state offers the ≥4★ bulk move.

**Export tab** — thumbnail grid of `exports/` with per-file delete; upload widget pinned to the exports folder.

**Deletion UX** — every destructive action goes through a confirm dialog stating exact file count and bytes; single-file deletes have their own confirm. Deleting the whole shoot lives in Settings behind a second confirmation.

### 3.4 Denoise monitor (live external-process watching)

Client opens SSE `GET /api/watch/[name]`. Server-side singleton watcher, one session per shoot shared by all subscribers:

- Polls `denoised/` every 2 s with `readdir` + `stat`.
- **Stability detection**: a DNG counts only after its size is unchanged for 2 consecutive polls (PureRAW writes files incrementally). Size change resets the counter. Disappeared files are dropped and trigger a count update.
- Emits `file` events (`dngCount`, `latestFile`, timestamp) when a new stable file appears; emits one `idle` event after 5 min without activity (with `idleMinutes`) — the client treats idle as "processing complete" and fires a browser Notification (permission requested in-UI).
- Session ends (interval cleared) when the last subscriber disconnects; dead controllers are pruned on broadcast.

Client UI: progress bar `dngCount / expectedTotal` (expected = stored `rawCount`, falling back to current ARW count), ETA = remaining × algorithm's per-file seconds (algorithm selectable in the widget, prefilled from metadata), latest file name, connected/disconnected indicator, idle/"complete" state.

### 3.5 Rating View (fullscreen culler) — the app's crown jewel

Opened over `denoised/`, `rated/`, or `selects/` at a chosen start index.

- **Layout**: toolbar (close, filter bar, position/rated counters, save-status indicator) / large preview / bottom bar (filename, star widget, exposure slider, hotkey hints) / horizontal filmstrip of all thumbs (active highlight, rating badge, dimming of filtered-out items, auto-scroll to current).
- **Keyboard**: `1–5` rate, `←/→` prev/next, `↑/↓` exposure ±0.25 EV (clamped ±5), `b` reset adjustments, `z` or Space toggle zoom, `Esc` un-zoom then close.
- **Zoom**: click toggles 1:1; click position maps to scroll position within the zoomed image.
- **Filtering inside the view**: All / Unrated / (≥ = ≤) × 1–5★. Navigation respects the filter (jumps to next/prev matching index); counters show "x / y filtered · n of m rated".
- **Exposure preview (WebGL2)**: preview is drawn to a canvas through a shader pipeline — sRGB→linear, exposure `×2^EV`, luminance-masked highlight/shadow gains, pivot-based contrast, mild tone-map, linear→sRGB. Pure preview aid for judging under/over-exposed raws; **never modifies files**. Falls back to a plain `<img>` if WebGL2 is unavailable. Adjustments persist across images until reset.
- **Save pipeline**: ratings buffer in an `unsaved` map, debounce-flushed after 500 ms as a batch; on success they move to a `remoteRatings` map; on failure they re-queue and retry (status chip: Saving… / Saved / Save failed). Closing flushes first. In `denoised` mode saving `POST`s `/rate` (which also **moves the files** to `rated/`); in other modes it `PATCH`es (rating update only).
- **Multi-client sync**: subscribes to SSE `/ratings-stream`; incoming ratings update the view unless the same file has unsaved local edits (local wins).
- **Prefetch**: `<link rel="prefetch">` for previous/next full-size previews.
- Effective rating precedence everywhere: unsaved edit → live/remote rating → rating passed in from the page → unrated (rated-file listings default missing ratings to 3).

### 3.6 Rated gallery (grid used by Rate and Selects tabs)

Responsive thumb grid; each card: image (click → open Rating View at that photo, unless in selection mode), star badge, inline editable star widget (rated tab; writes straight to Convex via client mutation), size, delete button. Multi-select via checkboxes with select-all; selection survives until file list changes; bulk move split-button (primary target: selects⇄rated; dropdown for any other folder) with busy state.

### 3.7 Live ratings on the shoot page

The page holds a Convex live query on the shoot's ratings (`convex-svelte` `useQuery`), so ratings changed anywhere (Rating View, another browser, inline widget) update badges, filters, "Move rated (n)" and "≥4★" counts in real time without reload.

### 3.8 Thumbnails & previews

`GET /api/thumbs/[shoot]/[file]?folder=exports|denoised|rated|selects&size=thumb|preview`

- Two sizes: thumb ≤600 px (grid/filmstrip; legacy exports path uses 400 px) and preview ≤2560 px WebP q85 (Rating View).
- **DNG handling**: Sharp can't decode DNG raw data, so the server scans the file for embedded JPEGs (SOI/EOI marker scan, >50 KB candidates, largest first, validated via Sharp, width must exceed 500 px), and applies the DNG's EXIF orientation to it. Falls back to handing Sharp the file directly (works for JPEG/PNG/TIFF exports).
- **Cache**: written to `.thumbs/` (`{folder}_{base}.webp` / `{folder}_{base}_preview.webp`; bare `{base}.webp` for legacy export thumbs), invalidated by mtime comparison with the source. Concurrent requests for the same asset are deduplicated via an in-flight promise map. Cache writes are fire-and-forget (failure only warns). Responses: `image/webp`, `Cache-Control: public, max-age=86400`.
- Export deletions also delete the matching cached thumbs.

### 3.9 Uploads

`POST /api/upload/[name]` — multipart, one file per request, `folder` field (default `raw`). Validates shoot exists, folder is known, extension is allowed for that folder. Filename sanitized (`/\:*?"<>|` → `_`, reject `..`). File is fully buffered in memory, then written; overwrites silently. `PATCH` recounts ARWs and persists `rawCount`. Clients upload in batches of 3 concurrent requests.

### 3.10 Moves & rating endpoints

- `POST /api/shoots/[name]/move` `{from, to, files[]}` (any two distinct folders) — per-file `rename`, missing files skipped, returns `movedCount`.
- `POST /api/shoots/[name]/rate` `{ratings: [{file, rating}]}` — move `denoised/→rated/` + upsert ratings + SSE broadcast. Files that fail to move get no rating written.
- `PATCH /api/shoots/[name]/rate` — upsert ratings only + SSE broadcast.
- `POST /api/shoots/[name]/selects` `{files[]}` — rated→selects convenience wrapper (a `minRating` param is accepted but currently ignored server-side; the ≥4★ computation happens client-side).

### 3.11 Downloads

`GET /api/shoots/[name]/download?include=raw,denoised,rated,selects,exports&flat=true|false` — streaming ZIP (Archiver, **store mode / no compression** since images don't compress), hidden files excluded, `flat` flattens vs. preserves `folder/file` paths (empty included folders still create directory entries), filename `{shoot}.zip`. Download dialog: checkbox per folder with file counts + sizes, live total, structure toggle; defaults select selects+exports; navigates via `window.location`.

### 3.12 Deletion

- `DELETE /api/shoots/[name]/files` `{folder, files?}` — delete named files, or (files omitted) sweep the folder of all non-hidden files matching that folder's deletable extensions (raw also sweeps `.xmp`). Returns `deletedCount` + `freedBytes`. Side effects: exports → delete cached thumbs; rated → delete Convex rating rows.
- `DELETE /api/shoots/[name]` — `rm -rf` the shoot dir + delete the Convex shoot and all its ratings.

### 3.13 Settings dialog

Edit denoise algorithm and notes (server form action `updateMeta`); shows folder name and total size; delete-entire-shoot with typed second confirmation, then redirect home.

## 4. API summary

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/shoots` | create shoot |
| DELETE | `/api/shoots/[name]` | delete shoot (disk + DB) |
| DELETE | `/api/shoots/[name]/files` | delete files in a folder |
| POST | `/api/shoots/[name]/move` | move files between folders |
| POST | `/api/shoots/[name]/rate` | rate + move denoised→rated |
| PATCH | `/api/shoots/[name]/rate` | update ratings only |
| POST | `/api/shoots/[name]/selects` | move rated→selects |
| GET | `/api/shoots/[name]/download` | streaming ZIP |
| GET | `/api/shoots/[name]/ratings-stream` | SSE: rating changes |
| GET | `/api/watch/[name]` | SSE: denoise progress |
| GET | `/api/thumbs/[name]/[file]` | thumb/preview WebP |
| POST | `/api/upload/[name]` | upload one file |
| PATCH | `/api/upload/[name]` | finalize (persist rawCount) |

Conventions: shoot name validated everywhere against the folder pattern + traversal checks (`..`, `/`, `\`); newer endpoints validate bodies with Zod; errors are a `PhotopipeError` (`NOT_FOUND` 404 / `INVALID_INPUT` 400 / `CONFLICT` 409 / `FS_ERROR` 500) mapped to SvelteKit `error()`.

## 5. Realtime — three coexisting mechanisms (rebuild target #1)

1. **Convex live query** — shoot page's live ratings.
2. **Custom SSE `ratings-stream`** — in-process broadcaster fed by the REST rate endpoints; Rating View's sync channel. *Not* fed by direct Convex client mutations (inline gallery edits reach Rating Views only via mechanism 1… which Rating View doesn't use).
3. **Custom SSE `watch`** — the 2 s polling denoise watcher.

A rebuild should pick **one** realtime primitive (single subscription/event bus; fs-events-based watcher instead of polling) and derive all live UI from it.

## 6. Configuration & deployment

- Env: `CAMERA_BASE` (required; container `/data/camera`), `CAMERA_HOST_BASE` (display-only, default `~/pictures/Camera`), `PUBLIC_CONVEX_URL` (required for metadata/ratings).
- Docker: 3-stage Alpine build (pnpm install → vite build → runtime with `vips` for Sharp), port 3000, compose mounts `./data/camera:/data/camera`.
- Dev: `pnpm dev` + `scripts/seed-test-data.sh` (seeds fake shoots incl. an ignored legacy folder). CI-ish scripts: `check` (svelte-check), `lint`, `format`, `audit`.
- **No auth by design** — trusted LAN / reverse-proxy responsibility.
- No tests exist.

## 7. Known weaknesses (what "more stable, better primitives" should fix)

**Architecture**

- **Split brain**: files on disk, metadata/ratings in a cloud DB. Lazy upserts, orphaned records, and "rating without file / file without rating" states are all possible; rated files with no rating silently display as 3★. A rebuild should have one authoritative store (or an explicit reconciliation layer) — and question whether a *self-hosted* app should depend on a cloud DB at all.
- **Three realtime channels** (see §5) with inconsistent coverage.
- Client bypasses the API for inline rating edits (direct Convex mutation), so server-side invariants/broadcasts are skippable.
- Status is derived from folder contents alone — moving files back "rewinds" status; `denoising` depends on a manually-finalized `rawCount` snapshot (skip the PATCH and status jumps straight to `ready`).

**Robustness**

- Uploads buffer whole files in memory (ARWs are ~25–50 MB; 3 concurrent ≈ 150 MB spikes); no streaming, no resume, silent overwrite, no checksum.
- Denoise watcher is a poll loop with size-stability heuristics; in-process singletons (watcher, broadcaster, in-flight maps) reset on restart and don't scale past one process.
- Embedded-JPEG extraction reads the entire DNG into memory and byte-scans it per cache miss.
- Filesystem mutations are non-atomic multi-step sequences (move files → then write ratings → then broadcast); partial failures are swallowed (`catch {}` skips) and simply reflected as skewed counts.
- Errors during batch operations are per-file silent; the UI mostly can't distinguish "moved 0" from "moved all".
- `createShoot`'s existence check is check-then-act (racy); several endpoints validate the same input twice while others rely on regex alone.
- ZIP download enumerates files with per-file `stat` before streaming; no size estimate or progress.

**Product-level gaps worth deciding on in the rebuild**

- Only Sony ARW raws are supported for the raw stage; folder set and pipeline order are hard-coded.
- `minRating` on the selects endpoint is accepted but unimplemented server-side.
- README/CLAUDE.md still describe the pre-Convex `.photopipe.json` architecture.
- No auth, no multi-user semantics despite realtime multi-client sync features.
- No pagination/virtualization — every view loads all files of a shoot (fine at hundreds, untested at thousands).
- No undo for any destructive operation; deletes are immediate and permanent.
