# Photopipe

A self-hosted photo pipeline for organizing camera shoots, running DxO PureRAW denoising workflows, and managing image exports.

Built with SvelteKit, Sharp, and deployed via Docker. No database — everything lives on the filesystem.

## Features

- **Shoot management** — Create dated shoots (`YYYY-MM-DD_slug-name`) with `raw/`, `denoised/`, and `exports/` subdirectories
- **Drag-and-drop uploads** — Upload ARW, DNG, and export files with progress tracking
- **Live denoise monitoring** — SSE-powered real-time progress as PureRAW processes your files
- **Thumbnail generation** — On-demand WebP thumbnails via Sharp with disk caching
- **ZIP downloads** — Download any combination of raw, denoised, and export folders as a single archive
- **PureRAW integration** — Shows host paths and settings for external denoising
- **Status tracking** — Shoots display their current state: empty, uploading, denoising, ready, or exported

## Quick Start (Docker)

1. Clone the repo and create a camera directory:

   ```bash
   git clone https://github.com/RaphaelMitas/photopipe.git
   cd photopipe
   mkdir -p data/camera
   ```

2. Start the container:

   ```bash
   docker compose up
   ```

3. Open [http://localhost:3000](http://localhost:3000)

Your photo shoots will live in `./data/camera/`. To use an existing photo directory, update the volume mount in `docker-compose.yml`.

## Quick Start (Development)

```bash
pnpm install
bash scripts/seed-test-data.sh
pnpm dev
```

This seeds sample shoots into `./test-data/Camera/` and starts the dev server.

## Configuration

| Variable           | Required | Default             | Description                                                     |
| ------------------ | -------- | ------------------- | --------------------------------------------------------------- |
| `CAMERA_BASE`      | Yes      | —                   | Path to the camera directory (inside container: `/data/camera`) |
| `CAMERA_HOST_BASE` | No       | `~/pictures/Camera` | Host-side path shown in PureRAW instructions                    |

Set these in `docker-compose.yml` (Docker) or `.env` (development). See `.env.example` for a template.

## Architecture

- **SvelteKit** with adapter-node for server-side rendering and API routes
- **Sharp** for on-demand WebP thumbnail generation
- **Archiver** for streaming ZIP downloads
- **Server-Sent Events** for real-time denoise progress monitoring
- **Filesystem-based** — no database; shoot metadata stored as `.photopipe.json` per shoot

## Security

Photopipe has no built-in authentication. It is designed for trusted local networks.

If you need to expose it to the internet, put it behind a reverse proxy with authentication (e.g., nginx basic auth, Authelia, Tailscale).

## License

[MIT](LICENSE)
