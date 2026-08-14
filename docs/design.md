# Design

What Photopipe is, and the decisions that shaped it. Written down because
several of these look arbitrary from the outside, and two of them were got
wrong first and reversed.

## Principles

**Disk is truth.** A project is a folder; its photos are whatever image files
sit anywhere inside it. Nothing is stored about where work stands, so nothing
can disagree with reality. Move files around in Finder and the app follows.

**Nothing moves on its own.** The only file operations are the ones you ask
for: import, export, reveal, delete.

**Judgment travels with the files.** Ratings and edits are XMP — a sidecar
beside a raw, embedded in a DNG or JPEG — so Lightroom and Capture One read
the same stars. The develop exposure uses `crs:Exposure2012`, the tag
Lightroom itself writes. Nothing you decide is trapped in a database only
this app can open.

**Delete means Trash.** Never an unlink, and it takes the photo's XMP sidecar
along, because leaving it behind would be a lie about what you asked for.

## One surface, not stages

Two earlier shapes were tried and reversed, and both are worth recording
because they looked reasonable.

The first attempt was a **stepper**: ordered steps with completion states.
A stepper says *you are here, and this is what remains* — a framing that only
works when the tool owns the whole process, and it didn't.

The second attempt was **pages** (Media / Edit / Export, DaVinci
Resolve-style), each a view of a stage folder: `original/`, `processed/`,
`export/`. Better, but it still encoded a pipeline the app no longer has.
Once denoising hand-offs were dropped and editing moved in-app, two of the
three pages were folders the app itself never fed, and the folder names were
rules the user had to learn.

The current shape is **one surface**:

```
┌──────────────────────────────────────────────────────────────┐
│  shoot · 412 photos                    Activity   Export N…  │
├───────────┬──────────────────────────────────────┬───────────┤
│ sidebar   │            grid / loupe              │  export   │
│ histogram │                                      │  drawer   │
└───────────┴──────────────────────────────────────┴───────────┘
```

Browse and rate in the grid, edit in the loupe, and leave through the Export
button. The export drawer is the only panel that opens and closes; everything
else is always there.

**Folders carry no meaning.** Subfolders inside a project are the user's own
sorting — the app walks them, shows one flat set, and displays the relative
path as part of the photo's name. There is nothing to learn and nothing to
get wrong.

**Every file is its own photo.** An ARW and a JPEG sharing a stem are two
entries, not a "lineage group". Grouping was built for the stage model (the
same shot moving through formats); flat, it only hid files. What you see in
the grid is exactly what is on disk.

## The histogram is the filter

The sidebar shows the rating spread as six bars (∅ then 1–5) with a count on
each. Clicking a bar filters to it; comparator chips (≥ = ≤ ∅) refine it.
One control answers both "how far am I" and "show me the keepers" — it
replaced the stage counts, which answered a question the flat model no
longer asks.

## Edits persist, export renders

The loupe's exposure slider writes to the photo's XMP (debounced, optimistic)
instead of being preview-only. Export offers two formats:

- **Original** copies the bytes untouched. Edits are ignored — this is
  "send the raws to the retoucher".
- **JPEG** renders every selected photo full-resolution through the raw
  pipeline with its persisted exposure baked in, sRGB, quality 90 or 100,
  the rating carried into the JPEG's XMP.

Destination is a folder or a zip. Flatten drops the subfolder structure;
name collisions (two `DSC01301.ARW` in different subfolders, or `x.arw` and
`x.jpg` both becoming `x.jpg`) get deterministic `-1`/`-2` suffixes rather
than a silent overwrite.

## Export always acts on the selection

There is no "export the filtered set" mode. The drawer's quick actions
(*Select filtered · n*, *All · n*) perform a real selection — the grid lights
up, and ⌘-click prunes it before committing. The count on the button and the
files that leave can never disagree, because there is only the selection.
*Select all* drops the rating filter first so no part of the selection is
ever invisible.

## Activity, not toasts

Exports run as jobs in the drawer's activity section: running, done (with a
reveal button), or failed with the error text kept on screen. A toast that
takes the error with it after four seconds is the wrong container for "two
files were skipped".

The core runs requests concurrently (an 8-wide queue, responses matched by
envelope id), so a long JPEG export occupies one slot while thumbnails and
ratings keep flowing. Per-file export progress needs mid-request events the
protocol doesn't have yet; until then the job shows an indeterminate state.

## Deliberately not built

- **Per-file export progress and presets** — cut from v1, see above.
- **Edit-aware thumbnails** — the grid shows the unedited thumbnail with a
  small ±EV badge; only the loupe renders the edit. Rendering every edited
  thumbnail through the raw pipeline is a cost the badge defers.
- **A catalogue.** Still the founding rule: the SQLite index is a rebuildable
  cache, never a source of truth.
