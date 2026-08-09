# Workflow design — pages, not steps

The first attempt at this modelled the workflow as a **stepper**: ordered steps
with completion states and a "next action". That was wrong. Photopipe's shape
is Resolve's: **pages** — a handful of workspaces you jump between freely,
each one a different tool for a different job, all looking at the same
project. Nothing is ever "complete", nothing gates anything.

## Principles

- **Disk is truth, and nothing moves.** The raw stays, the DNG stays, the JPG
  stays. An image's stage is derived from **the folder its file sits in** —
  `original/` (aliases: raw/, media/), `processed/` (denoised/), `export/`
  (exports/) — because external tools rename their output and location is the
  reliable signal. Files in unknown folders fall back to extension-derived
  stages, so legacy shoots keep working. No status field anywhere.
- **Renames don't break lineage.** A derived file whose stem extends an
  original's past a separator (`DSC00001-DxO.dng` from `DSC00001.ARW`) joins
  that original's group; `DSC00010` never merges into `DSC0001` (the boundary
  is a digit).
- **Culling only adds information.** Rating a photo writes XMP. It never
  moves, hides or removes a file.
- **The loop is open at every stage.** Process or edit in whatever tool you
  like; drop the results back into the project and they appear, linked to
  their original by filename stem. Later these become in-app tools, and the
  pages stay the same.
- **Files change only when you say so.** The two destructive-ish actions —
  delete and reveal in Finder — are explicit, act on your selection, and
  delete means *Trash*, never unlink.

## The pages

Top bar, and *only* the top bar: four page tabs. The sidebar shows just the
current shoot (name, date, counts, notes) plus the way back — the library
page is where shoots are browsed, one place to browse and one to work.
Pages are scoped to the open project and switch instantly (`⌘1`–`⌘4`).

```
┌──────────────────────────────────────────────────────────────┐
│  Media    Edit    Export                                     │  ← navigation only
├───────────┬──────────────────────────────────────────────────┤
│ sidebar   │                                                  │
│ project   │                page content                      │
│ counts    │                                                  │
│ filters   │                                                  │
│ actions   │                                                  │
└───────────┴──────────────────────────────────────────────────┘
```

### Media

The `original/` stage: every image that has an original capture — an ARW, or
the imported JPEG in a JPEG-first shoot — shown *as* its original, not as its
furthest export. Browsing is culling; culling only adds information.

- Justified grid, loupe, filmstrip, ratings, rating filters.
- **Temporary multi-select** — ⌘-click, shift-click, ⌘A, Esc to clear, like
  Finder. It drives the next action and then it's gone; nothing is persisted.
- Actions on the selection: **Open in…** (any app), **Export…**, **Reveal in
  Finder**, **Delete** (to Trash, with the whole lineage group and its XMP
  sidecars).

### Edit

The DNGs, back from the denoiser: your working set. Each page is a folder
view, so this one starts empty and fills as processed files land (FSEvents
links them to their originals by stem).

- Sending TO the denoiser happens on Media (its button hands the selected
  raws over). There is no separate Process page: processing happens inside
  the external tool, so a page for it could only re-show someone else's
  files.
- Select here → **Open in…** your editor. The status column answers
  "exported yet?". Export the finished JPEG back into the project and it
  moves on to the Export page.
- This is where in-app denoising and editing land later; the page's job
  doesn't change.

### Export

The images that have finished exports, and what to do with them.

- Select → choose a destination → copy the files there, or zip them flat for
  handing over.
- No delivery log, no "delivered" state: a zip is a thing you made, not a
  property of the project.

## What this replaces

The stepper, derived step statuses, `photopipe.json`'s flow config, durable
picks, and stage folders are all gone. What survives from that exploration:
XMP is still where per-image judgment lives (ratings), and hand-off is still
"open the files in an app and watch for what comes back".

## Wayfinding — how you know what's next

Free-jump pages need signposts, not gates. Three layers, all derived:

1. **Tab badges** — each tab counts what sits at its stage (`Edit ②` = two
   DNGs to work on; `Export ①` = one finished file). An inbox count, never a
   stepper; a fresh project shows nothing until files land.
2. **The next-step button** — always visible in the browser toolbar, primary
   colour. With nothing selected it selects everything the page (and the
   rating filter) shows: a starting point you can prune. With a selection it
   *is* the hand-off, from the page you send from: Media "Send 3 to
   PureRAW", Edit "Open 2 in Lightroom", Export "Export 5". The action is
   the transition; navigation stays free.
3. **Purpose lines** — every page states its job in one line in the toolbar
   ("Your originals. Rate and cull, then send keepers to your denoiser."),
   so Media no longer assumes you know it's the rating stage.

## One browser, two views

Every page shows the same `ImageBrowser`: a justified **grid** and a table
**list**, switchable top-right and remembered per page (Media defaults to
grid, stages to list). What varies per page is the info layer — Media's list
shows rating + stage, a stage page's list shows its waiting/done column, and
grid cells keep the hover overlay. Click/long-press/⌘-click behave
identically in both.

## Creating a project

"New project" lives on the library start page as the first tile: name +
date (defaults today) + notes → `<date>_<name>/original/` plus `photopipe.json`
holding `{notes, created}` — metadata only, never workflow state. The empty
project appears as a shoot immediately (the metadata file marks it as one),
opens straight onto its empty Media page, and its notes show on the library
card. Clicking the active shoot in the sidebar toggles back to the library.

## Core additions

Everything else already exists (scanner, lineage, ratings, thumbnails,
renders, FSEvents).

| Method | Does |
|---|---|
| `openIn` | Open paths in a chosen app (`/usr/bin/open -a`) |
| `reveal` | Select paths in Finder (`open -R`) |
| `trash` | Move an image's files (and XMP sidecars) to the Trash |
| `exportFiles` | Copy selected files to a folder, or zip them flat |
| `createProject` | Make `<date>_<name>/original/` + metadata file, rescan |

## Open questions

1. **Import** — not part of this change; photos still arrive in the project
   folder however they arrive today. A card-import flow belongs on Media
   when it comes.
2. **Remembering apps** — "Open in…" asks for the app the first time and
   remembers it per stage. App-wide setting or per-project?
3. **Delete scope** — deleting an image trashes its whole lineage group.
   Should there be a way to trash just the DNG (e.g. to redo a denoise)?
