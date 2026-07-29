# Photopipe

A self-hosted photo pipeline for organising camera shoots, running DxO PureRAW denoising, culling with star ratings, and managing exports.

Built with Next.js, Tailwind, SQLite and exiftool.

## How it works

**The disk is the source of truth.** Photopipe manages an ordinary folder tree that you can also share over SMB/NFS and edit with anything else — PureRAW, Lightroom, Finder. Ratings live _inside the image files_ as standard XMP (`xmp:Rating`), so a shoot folder is self-describing and your ratings travel with the files.

**SQLite is only an index.** A sync engine watches the tree and mirrors it into a local database so the UI can query it quickly. The index is disposable: delete it and it rebuilds on the next boot. Nothing is stored only in the database.

**Changes show up quickly, from anywhere.** Edit a rating in Lightroom over the network share and the app picks it up within a few seconds, because the watcher reconciles the change and pushes an invalidation to the browser.

```
raw/       camera originals (.arw)  — ratings go in .xmp sidecars
denoised/  PureRAW output (.dng)    — ratings embedded in the file
exports/   final edited images
.thumbs/   regenerable preview cache
```

`rated` and `selects` are **not folders** — they are views over `denoised/`:

| View    | Means                     |
| ------- | ------------------------- |
| rated   | `xmp:Rating` is set (1–5) |
| selects | `xmp:Label` is `Select`   |

Rating and curating therefore never move a file. Downloads still offer `rated` and `selects` as selectable sets and materialise them as folders inside the ZIP.

## Features

- **Shoot management** — dated shoots (`YYYY-MM-DD_slug-name`) with a `.photopipe.json` manifest
- **Streaming uploads** — files stream straight to disk, so a 50 MB raw is never buffered in memory
- **Rating view** — fullscreen culling with a filmstrip, rating filters, 1:1 zoom, and a WebGL exposure preview for judging under/over-exposed frames (preview only, never writes pixels)
- **Selects** — mark picks individually or promote everything at or above a rating in one action
- **Denoise progress** — watches PureRAW output land and estimates time remaining
- **Thumbnails** — embedded previews extracted with exiftool, resized by Sharp, cached in `.thumbs/`
- **ZIP downloads** — any combination of raw, denoised, rated, selects and exports, with an optional minimum rating

## Quick start (Docker)

```bash
git clone https://github.com/RaphaelMitas/photopipe.git
cd photopipe
mkdir -p data/camera data/index
docker compose up
```

Open <http://localhost:3000>. Shoots live in `./data/camera` — point the volume at your real photo directory to use it.

## Quick start (development)

```bash
pnpm install
cp .env.example .env      # then set CAMERA_BASE
pnpm dev
```

Point `CAMERA_BASE` at a directory containing real ARW/DNG files. `pnpm seed` creates a placeholder tree, but those files are not real images, so thumbnails and rating writes will not work on them.

## Configuration

| Variable           | Required | Default             | Description                                 |
| ------------------ | -------- | ------------------- | ------------------------------------------- |
| `CAMERA_BASE`      | Yes      | —                   | Directory holding the shoot folders         |
| `CAMERA_HOST_BASE` | No       | `~/pictures/Camera` | Host path shown in the PureRAW instructions |
| `PHOTOPIPE_DB`     | No       | `./data/index.db`   | Location of the disposable SQLite index     |

## Migrating from v1

v1 kept ratings in Convex and used `rated/` and `selects/` directories. To convert a tree in place:

```bash
node scripts/migrate-v1.mjs /path/to/Camera --dry-run   # inspect first
node scripts/migrate-v1.mjs /path/to/Camera
```

It stamps the old ratings into the files as XMP, folds `rated/` and `selects/` back into `denoised/` (labelling the former selects), and rewrites each manifest at version 2.

Back up your camera directory before running it.

## Notes

- Writing XMP into DxO DNGs makes exiftool report `Error copying hidden data`. That is a warning: it drops a small block of DxO-proprietary data it cannot relocate. Image data, previews and standard metadata are unaffected.
- Photopipe has **no authentication**. Run it on a trusted network or behind a reverse proxy that authenticates for it.

## License

[MIT](LICENSE)
