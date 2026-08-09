# Photopipe v2 — Implementation Plan

Companion to [FEATURES.md](FEATURES.md). Stack: Tauri 2 shell (thin Rust), React + shadcn/ui + Tailwind frontend, Swift sidecar binary (SwiftPM, no Xcode IDE) for the raw pipeline, SQLite index, exiftool for XMP.

## Principles

1. **Spike before commit.** The only existential risk — interactive raw exposure scrubbing through the sidecar → webview chain — gets a timeboxed proof-of-concept before any architecture hardens (Phase 0).
2. **Walking skeleton.** From Phase 1 on, the full stack (React ↔ Rust ↔ Swift sidecar) is wired end-to-end and released through CI, even while it does almost nothing. Every later phase extends a working, tested app.
3. **Tests land with the phase, not after.** Each phase below lists the tests that are part of its definition of done. CI must be green at every phase boundary.
4. **Test the seams, not the frameworks.** Business logic (scanning, lineage, ingest, XMP) lives in pure, deterministic functions in the Swift core and gets dense unit coverage. UI chrome gets component tests; full-app e2e stays a thin smoke layer.

## Repo layout

```
photopipe/
├── apps/desktop/          # Tauri app
│   ├── src/               # React + shadcn UI
│   ├── src-tauri/         # Rust shell (thin: spawn sidecar, forward IPC, asset protocol)
│   └── e2e/               # Playwright tests (mocked native layer)
├── core/                  # Swift package: `photopipe-core` sidecar binary
│   ├── Sources/
│   └── Tests/             # Swift Testing (`swift test`)
├── fixtures/              # small synthetic files in-repo; real raws fetched by script
│   └── fetch.sh           # downloads CC0 sample ARWs (raw.pixls.us) into fixtures/raw/, cached in CI
├── .github/workflows/
└── renovate.json
```

## Testing strategy

### Unit tests

| Layer | Runner | What gets tested |
|---|---|---|
| Swift core | Swift Testing via `swift test` | Shoot-folder parsing, stage derivation from extension, lineage linking (ARW↔DNG↔JPG stems), index diffing, ingest renaming/collision logic, sidecar protocol encode/decode, XMP value mapping |
| Rust shell | `cargo test` | Sidecar lifecycle (spawn/restart/kill), message framing, asset-protocol routing. Kept minimal — the shell is glue |
| React | Vitest + React Testing Library | Keyboard-shortcut dispatch, rating/select state machines, dashboard count rendering, grid virtualization behavior |

Rules: Swift logic is written filesystem-free where possible (functions take value types in, return value types out); filesystem-touching tests use per-test temp directories, never fixtures mutated in place. No mocking of SQLite — tests run against a real in-memory/temp DB.

### Integration tests (the most important layer here)

The sidecar is a standalone binary with a JSON protocol over stdio — so it's driven directly, no UI involved:

- Spawn `photopipe-core`, point it at a fixture shoot tree → assert the emitted index (counts, lineages, stages).
- Rating round-trip: send `setRating`, then re-scan and assert the XMP sidecar/embedded value — *and* verify with an independent `exiftool -Rating` read, so we test against the reference implementation, not our own writer.
- FSEvents: mutate the temp tree externally mid-session, assert the invalidation event arrives.
- Render: request an exposure-adjusted preview of a real ARW fixture → golden-image comparison with perceptual tolerance (Apple's raw output can shift slightly across macOS versions; assert on structure, not exact bytes).
- **Performance budgets as tests:** preview-render latency and 1,000-file scan time asserted against thresholds. These run on CI (generous threshold) and locally (strict), so regressions in the killer feature fail a build instead of being discovered by feel.

### E2E tests — and the macOS constraint

`tauri-driver` (Tauri's WebDriver e2e path) **does not support macOS** — WKWebView exposes no WebDriver endpoint. So true click-through-the-real-app e2e is off the table, and the strategy is layered instead:

1. **Playwright against the React app** in a browser, with the Tauri IPC layer replaced by `@tauri-apps/api/mocks` plus a fake sidecar responder. Covers the flows that matter: open library → dashboard counts → enter culling → rate with keyboard → filter selects → trigger denoise hand-off. Fast, deterministic, runs on every PR.
2. **Sidecar integration tests** (above) cover the native half with real files — together with (1) the full behavior is covered, just cut at the protocol seam rather than the pixels.
3. **Packaged-app smoke test**: CI builds the real `.app`, launches it, and asserts via the sidecar log/health endpoint that the window opened, the sidecar spawned, and a fixture library loaded. Thin by design — it exists to catch packaging/signing/spawn breakage, not UI logic.

### Fixtures

- Synthetic fixtures (tiny fake files with correct names/extensions) live in-repo for scanning/lineage/ingest tests — stage logic doesn't need real pixels.
- Real ARW/DNG samples (CC0, from raw.pixls.us, including a Sony ARW matching your body) are fetched by `fixtures/fetch.sh` and cached in CI — raw files are 25–50 MB and don't belong in git.

## Phases

### Phase 0 — Spike: prove the killer feature (timeboxed ~2 days)
Throwaway code, keep only measurements and learnings.
- Swift CLI: load ARW via `CIRAWFilter`, re-render at varying exposure, measure warm-render latency at loupe resolution on Apple Silicon.
- Minimal Tauri window streaming those renders; scrub a slider, measure end-to-end frame time.
- **Exit criteria:** measured numbers for render + transport; go/no-go on the sidecar-streaming design. Fallback ladder if slow: webview-side approximate gain while native catches up → native overlay for loupe only → AppKit rethink.

### Phase 1 — Walking skeleton + all infrastructure
- Repo layout above; pnpm + Vite + React + shadcn scaffold; Tauri 2 shell; Swift package with a `ping`/`version` protocol.
- Sidecar protocol v1 (JSON over stdio, versioned envelope) — spawn, handshake, graceful shutdown, crash-restart.
- **CI from day one** (see below) and `renovate.json` (see below).
- Test infra: Swift Testing, cargo test, Vitest, Playwright-with-mocks all wired and each running at least one real test.
- **Exit criteria:** `pnpm tauri dev` opens a window that displays the sidecar's version; CI green on lint + all four test runners; Renovate opens its dashboard PR.

### Phase 2 — Read-only library
- Shoot discovery over `<day>_<project>` root; stage derivation; lineage linking; SQLite index (rebuildable, delete-safe); embedded-JPEG thumbnail extraction; FSEvents watching.
- UI: pipeline dashboard with per-stage counts; virtualized thumbnail grid; thumbnails served via asset protocol (never base64 over IPC).
- Tests: dense Swift unit coverage on scanner/lineage/diffing; sidecar integration suite against fixture trees incl. external-mutation cases; 1,000-file scan perf budget; Playwright flows for dashboard + grid; grid virtualization component tests.
- **Exit criteria:** point the app at your real photo root; dashboard and grids are correct and stay correct when files change externally; index deletion loses nothing.

### Phase 3 — Culling
- Loupe with CIRAWFilter rendering; exposure/WB sliders (preview-only); 100% zoom; keyboard rating/pick/reject/select; compare mode; filters.
- XMP writes via bundled exiftool: sidecars for ARW, embedded for DNG/JPG; rating propagation across lineage.
- Sidecar retry semantics: the Rust manager's crash-restart currently re-sends the in-flight request, which is safe only for idempotent methods. Before mutating methods (`setRating`, ingest) land, either make them idempotent (client-supplied operation ids) or exclude them from auto-retry.
- Tests: XMP round-trip integration suite (incl. Lightroom-convention cases: existing sidecars, unknown tags preserved); golden-image render tests; **render-latency budget test**; Playwright keyboard-flow e2e; property-style tests on the rating state machine.
- **Exit criteria:** you can cull a real shoot start-to-finish in it, and Lightroom shows the same stars afterward.

### Phase 4 — Import & denoise hand-off
- SD-card detection; ingest into new/existing shoot with rename pattern; checksum verification; resume after interruption; card never modified.
- "Denoise selects" hand-off to PureRAW/Topaz (per FEATURES.md open question #4); watch for emitted DNGs, auto-link into lineage, propagate ratings.
- Tests: ingest unit tests (collision, partial-copy resume, checksum mismatch) on temp dirs; hand-off integration test with a *fake denoiser* script that emits DNG fixtures; Playwright import flow.
- **Exit criteria:** a real card imports verified and correctly named; a denoised DNG appearing on disk shows up linked and rated within seconds.

### Phase 5 — Ship it

The app only runs from the repo today: the Rust shell finds the Swift core
through `core/.build/...`, and exiftool through Homebrew. A packaged build
would open a window where every request fails and no rating could be written.
This phase makes the artifact real, in dependency order.

1. **Bundle the sidecar.** `externalBin` in `tauri.conf.json`; a build step
   compiling the Swift core in release and copying it to the target-triple
   name Tauri expects; `default_bin()` preferring the binary next to the app
   executable, dev path as fallback. Nothing else here is verifiable until a
   built `.app` talks to its core.
2. **Bundle exiftool.** Ship the official Image-ExifTool distribution as a
   bundle resource and run it with the system `/usr/bin/perl`, so rating works
   on a Mac that has never seen Homebrew. Discovery order becomes: env
   override → bundled → Homebrew → PATH, keeping `swift test` working against
   a dev machine's copy.
3. **Sign and notarize.** Hardened runtime, then sign **inside-out**: exiftool
   and the sidecar first, the app last. `--deep` is deprecated and unreliable
   for nested helpers, which is exactly what we have. Then `notarytool
   submit --wait` and `stapler staple`, credentials as repo secrets, in a
   tag-triggered release workflow.
4. **Build the real thing in CI, and smoke it.** CI runs
   `tauri build --debug --no-bundle` today, so it never produces a bundle and
   cannot catch packaging breakage. Add a job that builds the actual `.app`,
   launches it, and asserts the sidecar handshake.
5. **Permissions.** A library under Documents, Desktop or Downloads is gated
   by TCC. Needs usage-description strings and a first-run failure that
   explains itself instead of an empty library.
6. **Perf and memory.** Synthetic 10,000-photo library: scan time, memory
   across a long culling session, render-cache growth.
7. **Error surfacing.** The three failures a user can actually hit — dead
   sidecar, missing exiftool, permission denied — deserve an explanation in
   the window, not a toast that scrolls away.

**Stated requirements: macOS 15 (Sequoia) or later, Apple Silicon.** The
bundle's `minimumSystemVersion` and the Swift package's platform floor must
stay equal — if the bundle allows an older OS than the core was built for, the
app installs and opens and then every request fails, which is the exact
condition this phase exists to remove. `build-core.sh` builds the host triple
only, so an Intel Mac would get a sidecar that cannot run; a universal build
means compiling both arches and `lipo`-ing them, and is only worth doing when
someone actually needs it.

- **Exit criteria:** a notarized DMG that opens with a double-click on a Mac
  that has never had Homebrew, developer tools or this repo; the smoke test
  runs against the exact artifact that ships.

## CI (GitHub Actions)

- Runner: `macos-15` (Apple Silicon, Xcode 16/Swift 6 for Swift Testing) — required, CIRAWFilter and the packaged app need it. Lint/Vitest/Playwright-mocked can additionally run on `ubuntu-latest` for cheap fast feedback.
- PR pipeline: lint (Biome for TS/JS lint+format, clippy, swift-format) → unit (swift/cargo/vitest, parallel) → sidecar integration (fixtures cached) → Playwright → debug build.
- Main pipeline: PR pipeline + packaged-app build + smoke test; notarization on tags.
- Caching: pnpm store, cargo registry+target, SwiftPM `.build`, fixtures directory keyed on `fetch.sh` hash.
- All checks are required on `main` via branch protection — this is what makes Renovate automerge safe.

## Renovate

`renovate.json` at repo root — covers all four ecosystems (npm, cargo, SwiftPM, GitHub Actions):

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:best-practices",
    ":semanticCommits",
    ":dependencyDashboard"
  ],
  "timezone": "Europe/Berlin",
  "schedule": ["before 7am on monday"],
  "minimumReleaseAge": "3 days",
  "prConcurrentLimit": 5,
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 7am on the first day of the month"]
  },
  "packageRules": [
    {
      "groupName": "Tauri",
      "matchPackageNames": ["/tauri/"],
      "description": "tauri, @tauri-apps/*, tauri-build, tauri-plugin-* move in lockstep across npm and cargo"
    },
    {
      "groupName": "React",
      "matchPackageNames": ["react", "react-dom", "@types/react", "@types/react-dom"]
    },
    {
      "groupName": "linters & formatters",
      "matchPackageNames": ["/biome/", "/swift-format/"],
      "automerge": true
    },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true
    },
    {
      "matchManagers": ["github-actions"],
      "automerge": true
    },
    {
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true,
      "description": "Majors wait for manual approval from the dashboard — no surprise breaking PRs"
    }
  ]
}
```

Why these choices:
- **`config:best-practices`** — pins GitHub Action digests, pins dev deps, enables vulnerability alerts; strictly better than `config:recommended` for a solo project.
- **`minimumReleaseAge: 3 days`** — skips the window where malicious/broken releases usually get yanked (supply-chain hygiene).
- **Weekly schedule + PR limit** — dependency noise arrives in one Monday batch instead of dripping all week.
- **Automerge only where CI is proof**: devDeps minor/patch, linters, Actions. Runtime deps (React, Tauri, image handling) always get a human look. Majors are opt-in from the dashboard.
- **Tauri grouped across ecosystems** — a Tauri bump touches both `package.json` and `Cargo.toml`; ungrouped PRs would each break the build.
- Renovate's `swift` manager handles `Package.swift`/`Package.resolved`; nothing extra needed once the Swift package exists.
- Prerequisite: branch protection with required checks on `main` (Phase 1), otherwise automerge merges on nothing.
