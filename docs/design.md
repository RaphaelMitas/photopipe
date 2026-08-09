# Design

What Photopipe is, and the decisions that shaped it. Written down because
several of these look arbitrary from the outside, and one of them was got
wrong first and reversed.

## Principles

**Disk is truth.** A photo's stage is which folder its files sit in:
`original/`, `processed/`, `export/`. Nothing is stored about where work
stands, so nothing can disagree with reality. Delete a DNG in Finder and the
project honestly walks back a step.

**Nothing moves on its own.** The raw stays, the DNG stays, the JPEG stays.
Culling only *adds* information. The only file operations are the ones you
ask for: import, export, reveal, delete.

**Judgment travels with the files.** Ratings are XMP — a sidecar beside a
raw, embedded in a DNG or JPEG — so Lightroom and Capture One read the same
stars. Nothing you decide is trapped in a database only this app can open.

**Delete means Trash.** Never an unlink, and it takes the whole lineage group
plus its XMP sidecars, because leaving a photo's sidecar or DNG behind would
be a lie about what you asked for.

## Pages, not steps

The first attempt modelled the workflow as a **stepper**: ordered steps with
completion states and a "next action" button. It was wrong, and it is worth
recording why, because it looked reasonable.

A stepper says *you are here, and this is what remains*. That framing only
works when the tool owns the whole process. It does not: processing happens
in DxO, editing happens in Lightroom, and files come back at unpredictable
times and under changed names. Every completion state was therefore a guess
the app kept having to defend.

The right shape is DaVinci Resolve's: **pages**. A handful of workspaces you
jump between at will, each a different tool for a different job, all looking
at the same project. Nothing is ever complete, nothing gates anything, and
the order left-to-right is a hint rather than a rule.

```
┌──────────────────────────────────────────────────────────────┐
│  Media    Edit    Export                                     │  ← navigation only
├───────────┬──────────────────────────────────────────────────┤
│ sidebar   │                page content                      │
└───────────┴──────────────────────────────────────────────────┘
```

The top bar holds navigation and nothing else; everything informational lives
in the sidebar.

**There is no Process page.** Denoising happens inside an external tool, so a
page for it could only re-show someone else's files. Media sends raws out,
Edit holds what came back.

### Wayfinding without gates

Free-jump pages still need signposts. Three layers, all derived from disk:

1. **Tab badges** count what sits at each stage — an inbox count, never a
   stepper.
2. **The next-step button** is always visible in the toolbar. With nothing
   selected it selects everything the page shows, as a starting point you can
   prune; with a selection it *is* the hand-off. The action is the transition.
3. **Purpose lines** state each page's job in one sentence, so Media does not
   assume you know it is the rating stage.

## Interaction

**Click opens the photo.** That is the common case and it should cost one
click. Selecting is deliberate: hold for 400ms, or ⌘/shift-click. Once
anything is selected you are in select mode and plain clicks toggle, until
Escape clears it. Select mode is derived from "is anything selected", so
there is no mode flag that can drift.

**Selection is temporary.** It drives the next action and then it is gone.
Stems that disappear are pruned from it, so an action can never touch a photo
you cannot see.

**The grid is justified, never cropped.** Rows fill the width at a target
height and scale to fit. Vertical shots keep their full aspect: a square
`object-cover` crop butchers portraits, and portraits are first-class here.

## Lineage across renamed files

Denoisers rename their output. A derived file whose stem extends an
original's past a separator (`DSC00001-DxO.dng` from `DSC00001.ARW`) joins
that original's group. The boundary is guarded so `DSC00010` never merges
into `DSC0001` — the character after the anchor must not be a digit.

Files in unrecognised folders fall back to extension-derived stages, so a
shoot organised the old way still opens.

## Interface conventions

- **shadcn/ui via the CLI**, never hand-rolled equivalents. Components are
  vendored into `components/ui` and edited in place when needed.
- **lucide for every icon.** No text glyphs standing in for iconography.
- **Semantic colour tokens** (`bg-background`, `text-muted-foreground`), so a
  light theme is a class flip rather than a rewrite. Stage colours are the
  exception: they carry pipeline meaning, not theme meaning.
- **Brand assets in `brand/` are fixed.** The mark's ink follows
  `currentColor`; its accent is the app's primary.

## Open questions

1. **Import from a card.** Photos arrive in the project folder however they
   arrive today. A card-detection flow belongs on Media when it comes.
2. **Remembering apps.** The denoiser and editor are app-wide settings. Should
   a project be able to override them?
3. **Partial delete.** Deleting trashes the whole lineage group. Redoing a
   denoise would want a way to trash just the DNG.
