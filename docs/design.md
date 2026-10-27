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
beside a raw, embedded in a DNG, JPEG or PNG — so Lightroom and Capture One
read the same stars. TIFF and newer formats such as HEIC get a sidecar of
their own, since writing into them was never tested on real files, and so
does a DNG, JPEG or PNG on the iPad, which has no exiftool to write into a
file. The develop exposure uses `crs:Exposure2012`, the tag Lightroom itself
writes. Nothing you decide is trapped in a database only this app can open.

**Pick and reject are a flag, not a rating.** `p` and `x` set `xmpDM:pick`
to 1 or -1 and take it off again, `u` clears it. That is where Lightroom
Classic 13.2 and later keeps its flag, and a rejected photo keeps its stars.
Bridge's older reject, a rating of -1, reads as unrated: un-rejecting would
otherwise leave it behind to come back. Whether Lightroom reads a pick
another app wrote is still untested.

**Delete means Trash.** Never an unlink, and it takes the photo's XMP sidecar
along, because leaving it behind would be a lie about what you asked for. A
sidecar two raws share, like an ORF and its ORI, goes with the last of them.
Rejects leave the same way, all at once, behind a confirm: a first pass is
mostly "no", and that is the one place a keypress turns into a deletion.

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

## Stacks are a way through the loupe, not a grouping

A dance event is mostly bursts: the same couple, the same second, several
frames. With **Stacks** on, the loupe walks near-identical frames as one stop,
so the first pass asks "is this moment worth it" once instead of six times.
A rating or a flag there goes to every frame. Inside the stack, **Pick** flags
one frame and touches nothing else; it becomes the cover. Once a stack has a
pick, `⇧X` rejects the frames nobody judged, no flag and no stars, as a step
of its own. Pick used to move the stars onto one frame and clear the rest;
rejecting the rest with it would make one keypress the input to a deletion,
a second shooter's frame in the burst included.

This is not the grouping that was reversed above. That one hid files in the
grid; this one never touches the grid, is off until you turn it on, and every
frame stays one keypress away.

"Near-identical" is a Vision feature-print distance under 0.40 to every frame
already in the stack, within 60 s of its first. The 0.40 was set by eye on
consecutive pairs from a real event; capture time alone also grouped different
pictures of the same moment. A stack stays open for that minute, so a misfire
or a second shooter's frame mid-burst does not cut it. Instinct does not
choose inside a stack: on shoots culled without it, its pick matched the kept
frame no better than chance, so it only breaks ties for the cover and is
shown, not applied.

## The histogram is the filter

The sidebar shows the rating spread as six bars (∅ then 1–5) with a count on
each, between a ✕ bar for rejects and a ⚑ bar for picks. Clicking a bar
filters to it; ≥ = ≤ turn a star click into a range and ∅ is the unrated
bar; ⌘ adds a bar and ⇧ a range. Bars of one kind widen each other and the
two kinds narrow, so ⚑ with 4 and 5 is the picks with four or five stars.
The flag bars count across all stars, so the eight bars no longer add up to
the shoot. One control answers both "how far am I" and "show me the
keepers" — it replaced the stage counts, which answered a question the flat
model no longer asks.

## Edits persist, export renders

The loupe's exposure slider writes to the photo's XMP (debounced, optimistic)
instead of being preview-only. Export offers two formats:

- **Original** copies the bytes untouched. Edits are ignored — this is
  "send the raws to the retoucher".
- **JPEG** renders every selected photo with its persisted edits baked in,
  sRGB, quality 90 or 100, the rating carried into the JPEG's XMP. Size is
  Full, 2048, 1080 or a custom 256 to 16384 px on the long edge of the
  cropped, turned frame, for chats and social without a second app. A
  smaller photo keeps its size rather than being upscaled. The edits run at
  twice the target, never past the full frame, and a raw decodes at that
  size too, so any size under half the frame is also faster. No output
  sharpening or presets.

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

## Pasted settings never carry the framing

⌘C copies the look off a photo, ⌘V puts it on the loupe photo or on the
whole selection. It takes tone, colour and curves; crop, straighten and
rotation stay with the photo they were made for, because a crop rect is
normalized against its own turned frame and means something different on a
photo of another shape. White balance is Kelvin on raw and incremental
elsewhere, so it only crosses between photos of the same kind and the toast
says when it was left behind. There is no scope dialog: paste takes
everything it can, every time, and ⌘Z takes it back.

## Activity, not toasts

Exports run as jobs in the drawer's activity section: running, done (with a
reveal button), or failed with the error text kept on screen. A toast that
takes the error with it after four seconds is the wrong container for "two
files were skipped".

The core runs requests concurrently, and each request gets its own reply.
Renders and thumbnails each have a newest-first lane that answers the oldest
waiting request "superseded" once too many pile up; `setRoot` gets a thread of
its own; everything else shares an 8-wide queue, so a long JPEG export occupies one slot while ratings keep
flowing. Per-file export progress needs mid-request events the
protocol doesn't have yet; until then the job shows an indeterminate state.

## Deliberately not built

- **Per-file export progress and presets** — cut from v1, see above.
- **Edit-aware thumbnails** — the grid shows the unedited thumbnail with a
  small ±EV badge; only the loupe renders the edit. Rendering every edited
  thumbnail through the raw pipeline is a cost the badge defers.
- **A catalogue.** Still the founding rule: the SQLite index is a rebuildable
  cache, never a source of truth.
