# Engineering

Stack, testing strategy, CI and releases.

## Stack

- **Tauri 2** shell, deliberately thin: forward IPC to the core, own folder
  consent, serve the asset protocol.
- **React + shadcn/ui + Tailwind** frontend.
- **Swift core** (`core/`, SwiftPM, no Xcode IDE) — a static library the
  crate's build script compiles and links into the app, called over a small C
  ABI with JSON lines. It owns everything that touches pixels or metadata:
  scanning, `CIRAWFilter` rendering, thumbnails, XMP, FSEvents, file actions.
  The same code runs on macOS and iPadOS, except exiftool, FSEvents and zip,
  which are macOS-only.
- **exiftool** for XMP writes on macOS, bundled into the app. iPadOS writes
  sidecars with the native text writer instead.

```
photopipe/
├── apps/desktop/       Tauri app for macOS and iPadOS (src/ React, src-tauri/ Rust, e2e/ Playwright)
├── apps/web/           photopipe.net, Next.js on Vercel
├── packages/ui/        shadcn components and tokens shared by both apps
├── tooling/            shared tsconfig
├── core/               Swift package: the core, linked into the app
├── scripts/            build, vendor, smoke test, release
├── fastlane/           App Store metadata and upload lanes
├── fixtures/           XMP sidecars, curve samples, raw fetch script
├── docs/               this, design.md, screenshots
└── brand/              logo and icon source
```

### Why native

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

One JSON line in, one out, in-process. Rust hands Swift a request with a
callback and waits on a blocking thread until it fires, exactly once, or for
10 s (120 s for `setRoot`) and fails the request. A timed-out request keeps
running and its late answer is dropped; a walk that finishes after a newer
`setRoot` does not install its root. Renders and thumbnails go through
newest-first lanes, `setRoot` gets a thread of its own so a walk of a hung
volume cannot hold a slot, and everything else runs on a bounded queue. Quitting waits up
to three seconds for running work and then exits regardless; an exit hook
signals exiftool, which would otherwise outlive the app.

There is no process boundary, so a crash in the core is a crash of the app.
A fuzz pass of 422 corrupt and adversarial files through every entry point
found one: `CIImage(contentsOf:)` segfaults on a JPEG whose header claims a
huge frame. Non-raw images load through a `CGImageSource` for that reason.

## Testing

| Layer | Runner | Covers |
|---|---|---|
| Swift core | `swift test` | scanning, stage/lineage, XMP round-trips verified against a real exiftool, renderer, file actions, path containment |
| Rust shell | `cargo test` | bookmarks, remembered roots, a round trip through the linked core |
| React | Vitest | selection, browser views, stepper, keyboard |
| App | Playwright | full flows against a mocked core |
| Bundle | `scripts/smoke-bundle.sh` | a built `.app` is self-contained |

`tauri-driver` does not support macOS — WKWebView exposes no WebDriver
endpoint — so Playwright drives the React app in a browser with the IPC layer
mocked, and the native half is covered by the Swift suite and a round trip
through the linked core.
Together they cover the whole app, cut at the protocol seam.

The bundle smoke test is the one that catches shipping failures: every other
suite runs from a checkout, where exiftool is findable through dev paths. It
checks that the app binary links only what the OS ships, with the Swift
runtime found through `/usr/lib/swift`, then runs the exiftool *inside a
built bundle* with `PATH=/usr/bin:/bin` and no overrides; a written XMP
sidecar proves it is self-contained.

## CI

Two jobs. `quick` on Ubuntu does lint, typecheck, Vitest and Playwright.
`native` on macOS 15 does swift-format, `swift test`, clippy for macOS and the
iPad simulator, a simulator build of the iPad app, `cargo test`, then builds a
real `.app` and smoke tests it. Caches: pnpm, cargo, SwiftPM,
raw fixtures, vendored exiftool.

Real ARW fixtures are fetched by `fixtures/fetch.sh` (CC0, from raw.pixls.us)
rather than committed — they are 25–50 MB each.

## Releasing

Requirements: **macOS 15, Apple Silicon.** The OS floors must agree: the
bundle's `minimumSystemVersion`, the Swift package's platforms, and the
`SwiftLinker` versions in `build.rs`, plus for iPadOS 18 `tauri.ios.conf.json`
and `gen/apple/project.yml`. If the bundle allows an older OS than the core
was built for, the app installs and then fails to launch there.

`tauri-build` resolves `bundle.resources` at compile time, so a missing
exiftool fails `cargo clippy` and `cargo test`, not just the bundle. On a fresh clone run
`./scripts/fetch-exiftool.sh` once; the bundle build runs it automatically.

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
3. signs the app. exiftool needs no signature: it is a Perl script, not a
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

The App Store build ships as `net.photopipe.app`, a platform-neutral id an iOS
app can share one store record with; the DMG stays `net.photopipe.desktop`, so
the two keep separate preferences and a switcher picks their folder once more.
It is a second job, `mas`, that runs alongside the DMG release
and needs six more secrets: `MAS_CERTIFICATE` (base64 .p12 holding both an
Apple Distribution and a Mac Installer Distribution identity),
`MAS_CERTIFICATE_PASSWORD`, `MAS_PROVISIONING_PROFILE` (base64 Mac App Store
profile), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and
`APP_STORE_CONNECT_KEY` (the .p8 contents). Make the two certificates from
separate signing requests: when they share a private key, Keychain Access
says "Export 2 items" and writes one, and the pair has to be merged with
`openssl pkcs12 -export` instead. Without `MAS_CERTIFICATE` the job
is skipped and the release still succeeds. The job builds

```bash
pnpm --filter desktop tauri build --bundles app --config src-tauri/mas.conf.json -- --no-default-features
```

which compiles the `updater` cargo feature out and merges `mas.conf.json`
over `tauri.conf.json`: `plugins.updater` set to `null` removes the feed (the
merge is RFC 7396). The updater and restart permissions are granted at
runtime behind the same cargo feature, because `tauri-build` validates every
file under `capabilities/` against the plugins compiled in. Signing is by hand as for the
DMG, with `entitlements.mas.plist`, then `productbuild` wraps it in a signed
pkg. `scripts/smoke-bundle.sh --mas` checks the entitlements, the missing
updater and the pkg rules the store enforces. Every release then goes all the way to review through fastlane
(pinned by `Gemfile.lock`), so `pnpm release` needs no visit to App Store
Connect. The macOS job uploads the pkg. A second job, `mas-review`, on a Linux
runner because it mostly waits for Apple to process the upload, sends the
listing (text from `fastlane/metadata/en-US`, screenshots copied from
`docs/screenshots`, whose 2560x1600 is one of the Mac sizes deliver accepts),
attaches the build and submits it for review with automatic release. It
refuses to submit while the listing still says TODO or one of its URLs does
not load; the build is in TestFlight by then, so nothing is lost. A version
already waiting for review is pulled first, because Apple freezes it. The
store build number is the workflow run number, not the semver, because App
Store Connect refuses a number it has seen and a retry ships the same
version. `gh workflow run release.yml -f submit_to_app_store=true` redoes
only the store half from the tagged commit and leaves the DMG release
untouched. What the API cannot set stays a one-time job in App Store
Connect: price, age rating, the privacy questionnaire and the review
contact. Set the contact before the first submission: deliver crashes with
"No data" on a version that has none, and it stays out of the repo because
the repo is public.

The Rust shell owns sandbox consent: it shows the
folder panel, mints a security-scoped bookmark from the grant, keeps it in
`NSUserDefaults` and starts access. Access is never stopped for the life of
the process, because a scope stopped would vanish from under a running
export.
Before every listing the shell re-checks each folder, so an ejected drive
shows as unplugged and a renamed folder follows its bookmark. The old
localStorage root migrates into the list on first launch; the old recent
roots are dropped, the shell keeps its own five.
`bundle.macOS.entitlements` in `mas.conf.json` only matters for a local
signed build; the release job signs by hand with the same file. exiftool,
spawned through `/usr/bin/perl` from `Contents/Resources`, inherits the app's
sandbox. Nothing under `Contents/MacOS` may be unsigned, which is why
exiftool's Perl tree stays under `Resources`. A save panel grants one path,
so the zip export builds its archive in the destination volume's item
replacement directory and renames it into place rather than writing a
sibling beside the destination.

Retry a failed release with `gh workflow run release.yml`. If the tag was
already created, the retry checks out **that tag** and rebuilds it, rather
than whatever main has become: shipping different code under a version
someone may already have installed would be worse than the original failure.
Tags are never forced, so a released version always means one commit.

### iPad

`pnpm --filter desktop tauri ios dev "<simulator name>"` runs the same React
app and core on an iPad simulator. `tauri.ios.conf.json` gives it the store id
`net.photopipe.app` and leaves exiftool out; the Xcode project in
`src-tauri/gen/apple` is generated by `tauri ios init`, committed, and limited
to iPad. Library and export folders are picked in place by a Swift document
picker in the core's C ABI, because the dialog plugin cannot pick a folder on
iOS. The webview is pinned to the safe area, since the layout assumes nothing
covers it. CI runs clippy for the simulator and builds the simulator app,
which is the only step that links the core into it. Not there yet: watching the folder for
changes, zip export (hidden through the `features` command), import, ratings
and edits on anything but ARW (they are embedded, and only exiftool writes
those), ratings in exported JPEGs, Reveal (the opener plugin has no iOS
version), and aesthetic scoring, which fails in the simulator.

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
- **Error surfacing** for the failures a user can hit: missing exiftool,
  permission denied.
