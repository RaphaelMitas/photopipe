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

A second spike asked whether the sidecar survives the App Store sandbox, and
it does. Signed `app-sandbox` + `inherit`, the core reads, writes, thumbnails
and shells out to exiftool, `/usr/bin/zip` and the Finder entirely on access
the shell hands it. That access reaches a core that is **already running** —
resolving a bookmark and starting its access turns a `setRoot` that failed
with `permission denied` into one that succeeds, with no respawn. Bookmarks
themselves cannot cross the seam: they are bound to the app that minted them,
so an `inherit` child handed the bytes gets `NSCocoaErrorDomain 259`. They
live in the Rust shell, and the core keeps taking plain paths.

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
| App Store bundle | `scripts/smoke-bundle.sh --mas` | no updater, nothing unsignable under `MacOS`, sandbox entitlements on every binary |

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
6. tars the stapled app, signs it with the minisign key and writes
   `latest.json` — the feed the in-app updater reads
7. publishes the DMG, `photopipe-<version>.zip`, the tarball and `latest.json`
8. dispatches to `RaphaelMitas/homebrew-tap` to bump the cask

Secrets: `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and
`TAP_DISPATCH_TOKEN`. The tap step is guarded, so a release succeeds without
the last one.

Retry a failed release with `gh workflow run release.yml`. If the tag was
already created, the retry checks out **that tag** and rebuilds it, rather
than whatever main has become: shipping different code under a version
someone may already have installed would be worse than the original failure.
Tags are never forced, so a released version always means one commit.

### Updates

The app checks
`https://github.com/RaphaelMitas/photopipe/releases/latest/download/latest.json`
on launch and offers what it finds; `tauri-plugin-updater` verifies the
minisign signature before it replaces the bundle, so the endpoint is not
trusted with code. The public half lives in `tauri.conf.json`; the private
half exists only as a repo secret and a backup. **Lose it and installed apps
can never be updated again** — a new key means everyone reinstalls by hand.

`bundle.createUpdaterArtifacts` is deliberately off. It would tar the app
during `tauri build`, which here happens before the signing and notarization,
and would demand the signing key from every local and CI bundle build. The
release workflow tars the *stapled* app instead, with `--no-mac-metadata`:
AppleDouble `._` sidecars would end up inside the extracted bundle and break
its seal, while the ticket and `_CodeSignature` are ordinary files that
survive a plain tar.

Signing by hand also skips the mismatch check the CLI would do, so the step
compares the minisign key id in the signature against the one in the shipped
`pubkey`. Without it a rotated or mistyped key publishes a release that every
installed app rejects in silence.

The cask in `RaphaelMitas/homebrew-tap` needs `auto_updates true`, or
`brew upgrade` will reinstall over an app that has already updated itself.

### The App Store build

Same tag, same version, second job. `mas` builds
`tauri build --config src-tauri/mas.conf.json -- --no-default-features`, which
is the same app minus everything Apple will not take: no updater plugin, no
`updater:default` capability, no "Check for Updates…" item and no update
offer in Settings. `--no-default-features` is not optional, and the two halves
fail independently: the config merge alone removes the feed but still compiles
the plugin in. `scripts/smoke-bundle.sh --mas` greps the executable for both
`download/latest.json` (which only proves `mas.conf.json` was merged, since the
feed comes from the config) and `tauri_plugin_updater` (which proves the flag
was passed, since the crate name comes from the plugin's own code).

Two entitlement files, and the split matters. The app gets the sandbox, the
open panel's `user-selected.read-write`, `bookmarks.app-scope` so the folder
survives a relaunch, and `network.client`. That last one is not about the
network: without it a sandboxed WKWebView never loads the page at all, not
even `tauri://localhost`, which is served from inside the app. The app also
claims `com.apple.application-identifier` and
`com.apple.developer.team-identifier`: an app carrying an embedded
provisioning profile must state its own identity, and Xcode injects these at
signing where raw `codesign` does not. The core gets `app-sandbox` and
`inherit` and nothing else — any further key, including those two, and it
stops inheriting the shell's file access and starts asking for its own, which
it cannot have.

Store-side plist duties are covered in config: `bundle.copyright` becomes
`NSHumanReadableCopyright` (a submission requirement), and the `Info.plist`
beside `tauri.conf.json` merges `ITSAppUsesNonExemptEncryption` so uploads do
not stall in App Store Connect behind the export-compliance questionnaire.
`smoke-bundle.sh --mas` asserts both, plus world-readable payload permissions,
which App Store validation rejects when Tauri leaves files root-only
(tauri#13118).

exiftool stays in `Contents/Resources` despite the rule of thumb that says
executables belong in `Contents/MacOS`. codesign seals Resources as data but
demands every last file under `MacOS` be signed code in its own right, and a
tree of 250 Perl modules cannot be: moving it there fails signing outright
with *"code object is not signed at all"*. `smoke-bundle.sh` now asserts
`Contents/MacOS` holds only the two binaries so nobody rediscovers this.

Secrets, beside the eight above: `MAS_CERTIFICATE` (base64 .p12 holding both
the Apple Distribution and 3rd Party Mac Developer Installer certificates),
`MAS_CERTIFICATE_PASSWORD`, `MAS_PROVISION_PROFILE` (base64
`embedded.provisionprofile`), and for App Store Connect
`APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and
`APP_STORE_CONNECT_PRIVATE_KEY` (base64 .p8). Every step that needs them is
guarded, so until they exist the job still builds the bundle and smoke tests
it — which is what catches the build breaking.

Nothing is submitted on an ordinary release. The job signs, packages with
`productbuild` and validates against App Store Connect; the upload runs only
from `gh workflow run release.yml -f submit_to_app_store=true`. `CFBundleVersion`
must be strictly higher than anything already uploaded, so resubmitting a
rejected version needs a bump first — `pnpm release` does it per release, a
retry of the same version does not.

Still unproven: the open panel itself. A bookmark minted, resolved and
started inside a real signed sandbox works, and so does everything the core
does behind one, but nobody has yet clicked through **Choose your photos
folder** in a sandboxed build and watched thumbnails come back through the
asset protocol.

### Screenshots

`pnpm screenshots` captures `docs/screenshots/*.png` from the real UI against
the e2e mock, so the README cannot show an app that no longer exists. The
photos are landscapes drawn from each file name, deterministic and
machine-independent.

## Still to do

- **Permissions.** A library under Documents, Desktop or Downloads is gated by
  TCC; the app needs usage-description strings and a first-run failure that
  explains itself.
- **Perf and memory** against a synthetic 10,000-photo library, plus
  render-cache growth over a long session.
- **Error surfacing** for the three failures a user can hit: dead sidecar,
  missing exiftool, permission denied.
