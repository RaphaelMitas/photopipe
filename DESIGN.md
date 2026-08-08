# Design brief — v2 redesign pass

Timing: between Phase 3's culling core (done, committed) and the remaining
Phase 3 UI (compare mode, 100% zoom). Those features hard-code layout; this
redesign must land first. Do it on its own branch, keep every `data-testid`
stable so the Vitest/Playwright suites keep vouching for behavior.

## What's wrong (owner's words, made concrete)

1. **Folder selection** — the landing card with a text input is not the
   direction. Choosing a root is a rare event; it shouldn't be a whole screen
   with a form.
2. **Grid cells** — square 168px crops look dated and, worse, butcher
   vertical shots (`object-cover` on a square). The owner shoots a lot of
   vertical; portrait images are first-class.
3. **Stars** — text `★` glyphs look dated; iconography must be lucide,
   always. (The logo and brand kit are fine as they are — do not touch
   `brand/` or the app icons.)
4. **Hand-rolled components** — `components.json` is configured (style,
   lucide, `@/components/ui` alias) but no shadcn component was ever
   installed; every button/input/card is bespoke Tailwind. The redesign
   rebuilds the UI on real shadcn components installed via the CLI.
5. **No sidebar** — a collapsible sidebar is wanted: room for future options
   (Phase 4 adds import + denoise queue) and it frees vertical space that a
   top header wastes — again, vertical pictures.

## Direction

### Component discipline: shadcn via CLI, lucide for every icon

- Install components with the CLI (`shadcn` is already a devDependency):
  `pnpm --filter desktop exec shadcn add sidebar button input card tooltip
  slider skeleton scroll-area separator dropdown-menu` — adjust the list to
  what the screens actually need, but the rule is: if shadcn has the
  primitive, install and use it; never re-implement or "simplify" one by
  hand. Generated files live in `src/components/ui/` and are treated as
  vendored code (restyle via tokens and `className`, not by editing their
  internals).
- Bespoke components are allowed only where no shadcn primitive exists: the
  justified grid cells, the loupe canvas, the stars cluster (which composes
  lucide `Star`).
- Every icon in the app comes from `lucide-react` (already a dependency,
  and `components.json` already declares `"iconLibrary": "lucide"`). No text
  glyphs, no ad-hoc SVGs — the existing `Photopipe` brand mark is the one
  exception; it stays as-is.

### App shell: collapsible sidebar

- shadcn Sidebar installed via CLI (the `--sidebar-*` tokens already exist
  in `index.css`).
- Contents, top to bottom: shoot list (name, day, per-stage counts — this
  replaces the dashboard-as-home card grid as primary navigation), rating
  filter, then a footer with the current root + change-root action and a slot
  where Phase 4's import/denoise entries will go.
- Collapsible to an icon rail (⌘B toggle). (Amended during implementation:
  the loupe renders as a detail view inside the shell — sidebar stays visible
  and usable; collapse it for maximum canvas.)
- The top header shrinks to a slim bar (current shoot + counts) or disappears
  entirely inside a shoot — maximize vertical pixels.
- Keep `data-testid="shoot-<name>"` on shoot entries, `back`, `change-root`,
  `filter-<n>` working.

### Grid: justified rows, no crops

- Replace fixed square cells with justified rows (the photo-tool standard):
  fixed target row height (~220px), variable cell widths by aspect ratio,
  images shown whole (`object-contain` behavior via correct cell sizing, not
  cropping). Verticals get full height.
- Virtualization stays row-based — row heights are constant, so
  `@tanstack/react-virtual` needs no structural change; only the
  per-row packing (greedy fill to row width) is new. Keep the
  `initialRect` test hook and the "renders only the visible window" test.
- Overlay (stem, stage dot, rating) moves to hover/focus only; resting cells
  are clean pictures. Keep `data-testid="thumb"`, `data-stem`,
  `thumb-rating`.
- **Core enabler (required):** the scanner must emit pixel dimensions so the
  grid can lay out before thumbnails load. `CGImageSourceCopyPropertiesAtIndex`
  reads width/height from headers without decoding pixels (~fast); cache by
  (path, mtime) like the XMP embedded-rating cache. Add `width`/`height` to
  the display file or `ImageGroup` in the protocol; mirror in `core.ts` types
  and `e2e-mocks.ts` (give the mock dataset a mix of landscape and portrait).
  Fallback when unreadable: 3:2.

### Folder selection: demote it

- First run: minimal welcome — brand mark, one "Choose your photos folder"
  button driving the native dialog, plus a recent-roots list
  (localStorage). No text-input form on the happy path.
- Keep a typed-path affordance only as a hidden/secondary path for e2e
  (`root-input`/`root-submit` testids must keep working — Playwright runs in
  a browser with no native dialog).
- After first run the app boots straight into the library; switching roots
  lives in the sidebar footer.
- Root errors surface inline (`root-error` testid stays).

### Stars and iconography

- lucide `Star` with `fill` for set, outline for unset; consistent stroke
  weight across all icons (sidebar, stage indicators, EV, filter). Kill all
  text-glyph iconography.
- Keep `star-<n>` testids and the toggle-to-clear semantics (clicking current
  value clears to 0), `data-rating` attribute.

### Brand: unchanged

- The logo, `brand/` kit, and `src-tauri/icons/` stay exactly as they are.
- Dark-mode-first: culling happens in the dark; light theme is secondary.
  Audit contrast of muted foregrounds on the new surfaces.

## Constraints

- Tokens only for color/type changes (`index.css` CSS variables); no
  hard-coded colors in components (the loupe's `--pp-accent` fallback should
  fold into the token set).
- All existing `data-testid`s keep working; e2e flows (smoke + culling) and
  component tests must stay green without behavioral edits — visual-only
  test churn is a smell that behavior changed.
- No protocol changes beyond the dimensions field above.
- Exposure scrubbing, prefetch, placeholder-not-previous-photo behavior in
  the loupe are load-bearing correctness features — restyle around them,
  don't touch the logic.

## Suggested sequence

1. Core: dimensions in scanner + protocol + mocks (small, testable alone).
2. shadcn install: CLI-add the component set; migrate existing hand-rolled
   buttons/inputs/cards onto them with no visual redesign yet (pure swap,
   suite stays green — proves the testid contract survives).
3. Shell: sidebar + shell layout, dashboard content folds into it.
4. Grid: justified rows on top of dimensions.
5. Folder selection rework.
6. Stars/icons sweep.

Each step lands green on the full suite before the next.
