# Photopipe

Final logo package. One mark, generated from a single 64px geometry.

    ink     #16181D   drawn as `currentColor`
    accent  #FF7A2F   drawn as `var(--pp-accent, #FF7A2F)`
    dark    #1B1D23   surface colour used by the dark icon and social cards

Because ink is `currentColor`, an inline SVG inherits the surrounding text colour:

    .logo       { color: #16181D; --pp-accent: #FF7A2F; }
    .dark .logo { color: #FFFFFF; }

## mark/

    photopipe.svg                 primary
    photopipe-mono.svg            single colour, opacity retained
    photopipe-flat.svg            single colour, no opacity (stamps, embroidery, fax-grade printing)
    photopipe-small.svg           optical variant for 24px and below
    photopipe-lockup.svg          mark + wordmark, horizontal
    photopipe-lockup-stacked.svg  mark + wordmark, stacked
    photopipe-1024.png            transparent raster
    photopipe-lockup-1600.png     wide lockup raster

## macos/

    Photopipe.icns          drop into the app bundle, set CFBundleIconFile
    Photopipe-Dark.icns     dark-surface alternate
    Photopipe.iconset/      run `iconutil -c icns Photopipe.iconset` to rebuild
    icon-light.svg          1024 canvas, 824 body, superellipse corners
    icon-dark.svg
    menubar/photopipeTemplate*.png

### Menu bar

Two options.

**Template (recommended, one asset).** `photopipeTemplate.png` is pure black on
transparent. The `Template` filename suffix makes AppKit treat it as template art
and render it white in dark mode, white in the highlighted state, and correctly
against a wallpaper-tinted bar. Forced monochrome, so the accent goes away.

    let image = NSImage(named: "photopipeTemplate")!
    image.isTemplate = true
    statusItem.button?.image = image

**Explicit (two assets).** `photopipe-menubar-light.png` (black) and
`photopipe-menubar-dark.png` (white) if you need to control it yourself — for
example to keep the accent orange. You are then responsible for swapping on
appearance changes.

    let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    statusItem.button?.image = NSImage(named: dark ? "photopipe-menubar-dark"
                                                  : "photopipe-menubar-light")

`photopipe-menubar.svg` is the same art drawn in `currentColor`, for SwiftUI or web use.

For the app icon, set `CFBundleIconFile` to `Photopipe`. If you want the icon to
follow appearance on macOS 14+, ship both and swap `NSApp.applicationIconImage`
when the appearance changes.

## web/

    favicon.svg, favicon.ico (16/32/48/64), apple-touch-icon.png,
    icon-192.png, icon-512.png, icon-512-maskable.png, site.webmanifest,
    head.html (paste into <head>), Photopipe.tsx (React component)

## social/

    og-light.png, og-dark.png       1200x630 Open Graph cards
    avatar-light.png, avatar-dark.png   1024 square

## animated/

`photopipe-intro.svg` plays once and settles on the static mark: the block eases
in first, the slices follow from 0.30s. Use this for app launch and page load.

`photopipe-loop.svg` is the repeating version. Every element runs one animation of
the same length (3.49s) with its individual timing expressed as percentages inside
the keyframes, plus an exit phase so the restart is seamless. This matters: giving
each element its own duration and setting them all to `infinite` makes them restart
on different clocks and drift apart within a few cycles.

Both are self-contained (the CSS lives inside the file), so they animate in an
`<img>` tag, as a CSS background, or inline, and both respect
`prefers-reduced-motion`.

## Sizes

    primary        28px and up
    small variant  16-24px
    lockup         mark height 22px and up

Open `brand-sheet.html` for the visual reference.
