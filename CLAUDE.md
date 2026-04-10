# CLAUDE.md

Photopipe is a SvelteKit photo management app for organizing camera shoots, denoising workflows (PureRAW), and image exports. Built with Svelte 5, Sharp, and deployed via Docker with adapter-node.

## Common Commands

```bash
pnpm dev              # Start Vite dev server
pnpm build            # Production build
pnpm preview          # Preview production build
pnpm check            # Svelte type checking
pnpm check:watch      # Type checking with watch mode
docker compose up     # Run with volume-mounted camera directory
```

## Code Style Guidelines

### Svelte 5 Runes

All components use runes mode. Use `$props()`, `$state()`, `$derived()` — never legacy `export let` or `$:`.

```svelte
<script lang="ts">
	let { data } = $props();
</script>
```

### No Barrel Files

Do not create `index.ts` files that re-export from other modules. Import directly from the specific file.

### No Useless Comments

Do not add comments that merely describe what the code already clearly shows.

## Type Safety Guidelines

- **Avoid `as` type assertions** — use type guards or schema validation instead
- **Prefer `unknown` over `any`**
- **Let TypeScript infer** when possible
- **Use `satisfies`** for type checking without widening

## Project Structure

- `src/lib/components/` — Reusable Svelte components
- `src/lib/server/` — Server-only logic (config, shoots, file watcher)
- `src/lib/types.ts` — Core domain types
- `src/lib/utils.ts` — Pure utility functions
- `src/routes/api/` — API endpoints (thumbnails, uploads, downloads)
- Shoot folders follow `YYYY-MM-DD_slug-name` naming with `raw/`, `denoised/`, `exports/` subdirectories
