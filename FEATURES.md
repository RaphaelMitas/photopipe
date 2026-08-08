# Photopipe v2 — Features

A native macOS app (Apple Silicon) for organizing photoshoots: fast culling, format-driven pipeline status, and folder conventions that stay readable in Finder. This is a fresh start; nothing from previous iterations is assumed.

## The workflow it supports

Shoots live in folders named `<day>_<project_name>` (e.g. `2026-08-08_brand-shoot`). Within a shoot, a photo moves through a pipeline. **Stage is expressed by file format, not by folder:**

| Stage | Format | Meaning |
|---|---|---|
| Raw | `.ARW` | Straight off the card, untouched |
| Denoised | `.DNG` | Output of AI denoising (e.g. DxO PureRAW) |
| Export | `.JPG` / `.PNG` | Final delivered image |

**Ratings and select flags are metadata, not stages.** They are written as XMP (`xmp:Rating` 1–5, select flag as a label) so they travel with the image and are readable by Lightroom and other tools. A photo can be rated at any stage.

### Recommended pipeline order (change from the old habit)

Research on AI-denoise workflows is unambiguous: **cull first, denoise only the keepers, and denoise before editing** — denoisers like DxO PureRAW and Lightroom Denoise operate on the raw sensor data, and denoising an entire shoot wastes hours of GPU time and gigabytes of disk on photos that get rejected anyway.

So the pipeline the app is built around is:

```
Import (ARW) → Cull & rate (ARW) → Denoise the selects (ARW → DNG) → Edit externally → Export (JPG/PNG)
```

not the old `raw → denoised → rated → selects`.

## Core features (v1)

### 1. Shoot library
- Point the app at a root photos directory; it discovers all `<day>_<project_name>` shoots.
- Disk is the single source of truth. The app keeps a local rebuildable index (for speed) but never disagrees with the filesystem — files added, moved, or deleted by other tools (Finder, Lightroom, the denoiser) are picked up automatically.
- Deleting the index loses nothing; it fully rebuilds from files + XMP.

### 2. Pipeline dashboard
- One screen showing every shoot with per-stage counts: e.g. `342 raw · 51 rated · 24 selects · 24 denoised · 0 exported`.
- Instantly answers "what's unfinished?" — highlights shoots with selects that haven't been denoised, or denoised files never exported.
- Sort/filter by date, project name, completeness.

### 3. Culling UI (the heart of the app)
- Full-screen, keyboard-first review: `1–5` to rate, `P`/`X` pick/reject, `S` toggle select, arrows to navigate, `Space` for loupe, `Z` for 100% zoom (focus check).
- **Raw-data preview adjustments:** exposure/brightness (and white balance) sliders that re-render from the actual ARW sensor data via Core Image's `CIRAWFilter` — hardware-accelerated on Apple Silicon. This is the capability the old browser-based approach could never deliver: judging an underexposed frame by pushing it +2EV without leaving the culling view. Adjustments are preview-only; the file is never modified.
- Fast grid view backed by embedded JPEG previews (instant), switching to full raw decode in loupe view.
- Compare mode: two to four candidates side by side for near-duplicate sequences.
- Filter the view by rating/select/stage while culling.

### 4. Format-driven status + XMP metadata
- Stage is derived from extension (`ARW`/`DNG`/`JPG`), never stored in a database as opinion.
- Ratings/selects written via exiftool-compatible XMP: embedded in DNG/JPG; for ARW, `.xmp` sidecars by default (writing into proprietary raw files is riskier — open question below).
- Everything Lightroom-interoperable: rate in Photopipe, see stars in Lightroom, and vice versa.

### 5. SD-card import
- Detect inserted card, ingest into a new or existing `<day>_<project_name>` shoot.
- Consistent renaming on import (pattern configurable, e.g. `<day>_<project>_<seq>`).
- Checksum verification after copy; card is never auto-erased.

### 6. Lineage tracking
- The same shot exists as up to three files (`ARW`, `DNG`, `JPG`). The app links them by filename stem into one *image* with a stage history, so the dashboard and culling UI show one logical photo, not three files.
- Rating/select metadata propagates across the lineage: a 5-star ARW's DNG is 5-star too.

### 7. Denoise hand-off
- "Denoise selects" action: sends the selected ARWs to the external denoiser (DxO PureRAW / Topaz as configured), then watches for the resulting DNGs and links them into the lineage automatically.
- The app never denoises itself in v1 — it orchestrates.

## Non-goals (v1)
- No raw developing/editing (that stays in Lightroom/Capture One).
- No export rendering — exports are produced by the editor; the app just tracks and counts them.
- No cloud sync, no accounts, no web UI. Local, fast, native.
- No video handling.

## Platform & tech direction (high level)
- Desktop app via **Tauri 2**: React + shadcn/ui + Tailwind frontend in the native WKWebView shell. Apple Silicon first.
- **Swift core** as a Tauri plugin for everything performance-critical: ARW decoding, embedded-preview extraction (ImageIO), and adjustable raw rendering on the GPU via `CIRAWFilter` (Core Image). Rendered previews stream to the UI over a custom asset protocol.
- Built without the Xcode IDE: Swift side compiles with SwiftPM/command-line toolchain; app bundling via Tauri's CLI.
- Metadata: XMP read/write (exiftool or a native library — to be decided in the architecture doc).
- Index: SQLite, rebuildable from disk at any time.
- Filesystem watching (FSEvents from the Swift core) so external changes appear without manual refresh.

## Open questions
1. **XMP in ARW:** you said ratings "within the raw file". Embedding XMP directly into ARW is possible with exiftool but nonstandard — Lightroom & friends expect `.xmp` sidecars next to proprietary raws. Recommendation: sidecars for ARW, embedded for DNG/JPG. OK?
2. **Old shoots:** should the app also understand the legacy `raw/denoised/rated/selects` folder layout for existing projects, or is migration a one-time script?
3. **Rejects:** what happens to rejected ARWs — keep forever, move to a `rejected/` subfolder, or offer a "purge rejects" action?
4. **Denoiser:** which tool do you actually use (DxO PureRAW / Topaz / Lightroom)? Determines how the hand-off works. Note: recent Lightroom Denoise no longer emits DNGs — it applies denoising as an edit — which would break the "DNG = denoised" convention; PureRAW still outputs DNGs.
