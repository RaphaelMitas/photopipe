# Phase 0 spike — results

Test image: `DSC00832.ARW` — Sony A7 IV (ILCE-7M4), 7008×4672 (33MP), 41 MB, from the real
`2026-07-12_zell` shoot. Machine: this MacBook (Apple Silicon, macOS 26). All renders via
`CIRAWFilter` → Core Image → JPEG q0.85, Display P3.

## Leg 1 — Swift render pipeline (`raw-spike bench`)

| Measurement | Result |
|---|---|
| Cold: `CIRAWFilter` init | 122 ms |
| Cold: first render + encode (loupe 2000px) | **2317 ms** |
| Warm re-render + encode, loupe 2000px | **32 ms median** (p95 33 ms) → ~31 fps |
| Warm re-render + encode, thumb 800px | 33 ms median |
| Warm re-render + encode, full-res 33MP | 53 ms median (16.5 MB JPEG) |
| Warm re-render + encode, loupe, `scaleFactor 0.5` (draft) | **5.4 ms median** → ~185 fps |

Findings:
- The exposure *parameter change* is free; the cost is executing the raw pipeline at target
  resolution + JPEG encode. `scaleFactor 0.5` cuts the raw pipeline to quarter work: 6× faster.
- The 2.3 s cold hit happens once per image (pipeline compile + upload). Must be hidden by:
  show embedded JPEG instantly → pre-warm CIRAWFilter for current±1 images in background.
- Loupe-res JPEG at q0.85 is ~1.7 MB full / smaller in draft — fine for local IPC transport.

## Leg 2 — end-to-end through Tauri (slider → Rust → Swift sidecar → webview paint)

Auto-benchmark in the spike app (100 draft frames + 20 full frames, includes IPC both ways,
blob URL, `img.decode()`, and a paint frame):

| Path | Median | p95 |
|---|---|---|
| Draft scrub (scaleFactor 0.5) | **33 ms** (~30 fps) | 34 ms |
| Full quality (on slider release) | **33 ms** | 66 ms |

Findings:
- End-to-end is ~33 ms/frame regardless of render mode — since Swift-side draft render is only
  5.4 ms, the e2e time is dominated by transport + JPEG decode + paint, and quantized by the
  measurement's `img.decode()` + `requestAnimationFrame` wait (up to a full display refresh is
  *measurement*, not felt latency).
- Draft p95 of 34 ms means frame times are extremely consistent — no jank spikes. With
  latest-wins frame dropping, the slider feels continuous.
- Clear optimization headroom for later (not needed for go/no-go): lower draft JPEG quality,
  custom asset protocol instead of invoke+blob URL, decode off main thread via
  `createImageBitmap`.

## Verdict

**GO.** The sidecar-streaming design holds:
- ~30 fps sustained exposure scrubbing on a real 33MP A7IV file, end to end through
  stdio IPC and the webview, with tight variance — before any optimization.
- The two real risks surfaced are *manageable design constraints*, not blockers:
  1. **Cold-open cost (2.3 s/image)** → architecture must show the embedded JPEG instantly and
     pre-warm CIRAWFilter for neighbors; loupe becomes adjustable ~2 s after landing on a new
     image, which is acceptable for culling flow.
  2. **Transport dominates, not rendering** → the v1 architecture should use a custom URI
     protocol for frames (zero-copy-ish, no blob URL churn) rather than `invoke` ArrayBuffers.
- Draft/full split is the right model: scrub in draft (5 ms native cost), settle full quality
  on release.

Spike code is throwaway (`spike/`); these numbers seed the Phase 3 latency-budget tests.
