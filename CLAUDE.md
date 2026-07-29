# CLAUDE.md

Photopipe is a Next.js photo management app for organising camera shoots, denoising workflows (DxO PureRAW), culling, and exports. Self-hosted, deployed via Docker.

## Common Commands

```bash
pnpm dev              # Next dev server
pnpm build            # Production build
pnpm start            # Serve the production build
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint
pnpm format:fix       # Prettier
docker compose up     # Run with the camera directory mounted
```

## Architecture

Authority runs one way: **disk > SQLite index > UI cache**.

- **Disk is the source of truth.** The camera tree is also shared over the network and edited by other tools (PureRAW, Lightroom, Finder), so the app must tolerate external mutation at any time.
- **Per-image metadata lives in the files** as standard XMP: `xmp:Rating` for stars, `xmp:Label = 'Select'` for curated picks. Embedded for DNG/JPEG; `.xmp` sidecars for ARW, because writing into proprietary raw is unsafe. All XMP access goes through `src/lib/xmp.ts` (exiftool-vendored).
- **SQLite (`src/lib/db/`) is a disposable index**, never a second source of truth. Bump `SCHEMA_VERSION` in `db/client.ts` to force a rebuild; the sync engine repopulates it.
- **The sync engine (`src/lib/sync/`)** watches the tree (chokidar), debounces into a dirty set, reconciles stages into the index, and emits invalidation events. A periodic full scan is the safety net.
- **One realtime channel**: `GET /api/events` streams invalidation notices only — no data. The client maps them to React Query invalidations in `src/app/providers.tsx`.
- **Writes are write-through**: mutate the file first, then mirror into the index (including the post-write mtime, which is what stops the watcher from re-reading our own edits).

`rated` and `selects` are **queries, not folders**: rated = rating set, selects = label set, both over `denoised/`. Physical stages are only `raw`, `denoised`, `exports`. Downloads materialise the virtual sets as folders inside the ZIP.

## Code Style

- **No barrel files.** Import directly from the specific module.
- **No useless comments.** Only explain non-obvious _why_, never restate the code.
- **Avoid `as` assertions** — use type guards or schema validation. Prefer `unknown` over `any`. Let TypeScript infer.
- Tabs, single quotes, semicolons, printWidth 100 (Prettier enforces).
- Server-only modules import `'server-only'`. Client components are marked `'use client'`.
- Next 16 ships the React Compiler lint rules: no setState synchronously in an effect, no ref writes during render, no impure calls (`Date.now()`) during render.

## Project Structure

- `src/lib/` — config, types, paths, errors, XMP, manifest, thumbnails, shoot queries/mutations
- `src/lib/sync/` — watcher, reconciler, invalidation bus
- `src/lib/db/` — Drizzle schema and client
- `src/app/api/` — route handlers
- `src/components/` — React UI
- `scripts/migrate-v1.mjs` — converts a v1 tree (Convex ratings, rated/ + selects/ dirs) to v2

## Docs

`docs/functional-spec.md` describes the v1 behaviour this app reimplements. `docs/rebuild-architecture.md` is the design this codebase follows.
