# Engineering

Stack, testing strategy, CI and releases.

## Stack

- **Tauri 2** shell, deliberately thin: spawn the sidecar, forward IPC, serve
  the asset protocol.
- **React + shadcn/ui + Tailwind** frontend.
- **Swift core** (`core/`, SwiftPM, no Xcode IDE) — a standalone binary
  speaking line-delimited JSON over stdio. It owns everything that touches
  pixels or metadata: scanning, `CIRAWFilter` rendering, thumbnails, XMP,
  FSEvents, file actions.
- **exiftool** for XMP writes, bundled into the app.

```
photopipe/
├── apps/desktop/       Tauri app (src/ React, src-tauri/ Rust, e2e/ Playwright)
├── core/               Swift package: the photopipe-core sidecar
├── scripts/            build, vendor, smoke test, release
├── docs/               this, design.md, screenshots
└── brand/              logo and icon source
```

### Why a sidecar

The reason this app is native at all is interactive exposure while culling.
The Phase 0 spike measured it on a 33MP Sony ARW:

| Measurement | Result |
|---|---|
| Cold `CIRAWFilter` init | 122 ms |
| Cold first render, loupe 2000px | 2317 ms |
| **Warm re-render, loupe 2000px** | **32 ms median** (~31 fps) |
| Warm re-render, draft `scaleFactor 0.5` | 5.4 ms median |

Warm scrubbing is comfortably interactive, and the cold first render is why
the loupe shows the thumbnail immediately and prefetches neighbours.

### Protocol

JSON over stdio, versioned envelope, concurrent: requests run on a bounded
work queue and responses may come back out of order, matched by id. The Rust
side multiplexes, poisons a desynced connection, replays the root after a
respawn, and never auto-retries a mutating method.

## Testing

| Layer | Runner | Covers |
|---|---|---|
| Swift core | `swift test` | scanning, stage/lineage, XMP round-trips verified against a real exiftool, renderer, file actions, path containment |
| Rust shell | `cargo test` | sidecar lifecycle, framing, crash-restart, timeouts |
| React | Vitest | selection, browser views, stepper, keyboard |
| App | Playwright | full flows against a mocked core |
| Bundle | `scripts/smoke-bundle.sh` | a built `.app` is self-contained |

`tauri-driver` does not support macOS — WKWebView exposes no WebDriver
endpoint — so Playwright drives the React app in a browser with the IPC layer
mocked, and the native half is covered by driving the sidecar binary directly.
Together they cover the whole app, cut at the protocol seam.

The bundle smoke test is the one that catches shipping failures: every other
suite runs from a checkout, where the core and exiftool are findable through
dev paths. It drives the core *out of a built bundle* with `PATH=/usr/bin:/bin`
and no overrides, and a written XMP sidecar proves the bundled exiftool ran.

## CI

Two jobs. `quick` on Ubuntu does lint, typecheck, Vitest and Playwright.
`native` on macOS 15 does swift-format, `swift test`, clippy, `cargo test`,
then builds a real `.app` and smoke tests it. Caches: pnpm, cargo, SwiftPM,
raw fixtures, vendored exiftool.

Real ARW fixtures are fetched by `fixtures/fetch.sh` (CC0, from raw.pixls.us)
rather than committed — they are 25–50 MB each.

## Releasing

Requirements: **macOS 15, Apple Silicon.** The bundle's
`minimumSystemVersion` and the Swift package's platform floor must stay
equal; if the bundle allows an older OS than the core was built for, the app
installs, opens, and then every request fails. `scripts/build-core.sh` builds
the host triple only, so an Intel Mac would get a sidecar that cannot run.

`tauri-build` resolves `externalBin` and `bundle.resources` at compile time,
so a missing Swift core or missing exiftool fails `cargo clippy` and
`cargo test`, not just the bundle. On a fresh clone run
`./scripts/prepare-bundle.sh` once; the bundle build runs it automatically.

```bash
pnpm release            # patch
pnpm release minor
pnpm release 1.0.0
pnpm release --dry-run  # print the plan
```

The script bumps the version in `tauri.conf.json`, `package.json`,
`Cargo.toml` and `Cargo.lock`, refreshes the README screenshots from the live
UI, and opens an auto-merging PR. When it lands on main, the Release workflow
notices the version has no tag and:

1. tags the merge commit
2. builds the app
3. signs **inside-out** — the Swift core first, then the app. `--deep` is
   deprecated and unreliable for nested helpers, which is exactly what a
   sidecar is. exiftool needs no signature: it is a Perl script, not a
   Mach-O, and the app's seal covers it.
4. notarizes, staples, and builds the DMG *from the stapled app*
5. signs and notarizes the DMG in its own right
6. publishes the DMG and `photopipe-<version>.zip`
7. dispatches to `RaphaelMitas/homebrew-tap` to bump the cask

Secrets: `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`, and
`TAP_DISPATCH_TOKEN`. The tap step is guarded, so a release succeeds without
the last one.

Retry a failed release with `gh workflow run release.yml`. If the tag was
already created, the retry checks out **that tag** and rebuilds it, rather
than whatever main has become: shipping different code under a version
someone may already have installed would be worse than the original failure.
Tags are never forced, so a released version always means one commit.

### Screenshots

`pnpm screenshots` captures `docs/screenshots/*.png` from the real UI against
the e2e mock, so the README cannot show an app that no longer exists. The
photos are stand-in gradients derived from each path, deterministic and
machine-independent.

## Still to do

- **Permissions.** A library under Documents, Desktop or Downloads is gated by
  TCC; the app needs usage-description strings and a first-run failure that
  explains itself.
- **Perf and memory** against a synthetic 10,000-photo library, plus
  render-cache growth over a long session.
- **Error surfacing** for the three failures a user can hit: dead sidecar,
  missing exiftool, permission denied.
