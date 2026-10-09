import { BREW_INSTALL } from "@/lib/release";

export const FAQ = [
  {
    question: "Is Photopipe free?",
    answer:
      "Yes. Photopipe is free on the Mac App Store, as a DMG and through Homebrew, with no subscription, no paid tier and no account. The source code is on GitHub under the MIT licence.",
  },
  {
    question: "What can I edit in Photopipe?",
    answer:
      "Global edits on the whole photo: exposure, highlights, shadows, whites, blacks, texture, clarity, dehaze, white balance, vibrance, saturation, RGB and per-channel curves, Neural Engine denoise on raw files, and crop, straighten and rotate. Copy a look onto a whole selection, undo anything with ⌘Z, and export full-resolution JPEGs with the edits baked in. Local adjustments such as masks and brushes, HSL, presets and lens correction controls are not there yet.",
  },
  {
    question: "Which Macs does Photopipe run on?",
    answer:
      "macOS 15 Sequoia or later on Apple Silicon (M1 and newer). Intel Macs are not supported, and there is no Windows or Linux version.",
  },
  {
    question: "Which file formats does Photopipe open?",
    answer:
      "Sony ARW and DNG raw files, plus JPEG and PNG. Other raw formats, such as Canon CR3 or Nikon NEF, are not supported yet.",
  },
  {
    question: "How do I install Photopipe?",
    answer: `From the Mac App Store, as a signed and notarized DMG from GitHub Releases, or with Homebrew: ${BREW_INSTALL}. The DMG and Homebrew builds offer their own updates; the App Store build updates through the App Store.`,
  },
  {
    question: "Does Photopipe work with Lightroom?",
    answer:
      "Yes, side by side. Star ratings and edits are written as XMP: a sidecar next to a raw file, embedded in DNG and JPEG files. Edits use Lightroom's own crs tags, such as crs:Exposure2012. Lightroom Classic, Capture One and Photo Mechanic read the same star ratings, so you can cull in Photopipe and finish in Lightroom.",
  },
  {
    question: "Is Photopipe a free Lightroom alternative?",
    answer:
      "For a shoot you cull, edit with global adjustments and export, yes, without a catalogue or an import step: Photopipe opens a folder, scores it, and writes every decision back to the files. If you rely on masks, presets, HSL or a catalogue with keywords and collections, not yet, and because ratings and edits are saved as XMP you can finish those photos in Lightroom.",
  },
  {
    question: "Does Photopipe have AI culling?",
    answer:
      "Yes, and it runs on your Mac. Instinct scores every photo with Apple's Vision aesthetics model, straight from the raw file. Each photo gets one number from 0 to 100 that means the same in every project, and sorting by it puts the stronger frames first. It is a first sort, not a replacement for your judgement: it never rejects or deletes anything, and the score stays in Photopipe's rebuildable cache, not in your files.",
  },
  {
    question: "Does Photopipe upload my photos?",
    answer:
      "No. There is no account, no telemetry and no cloud; photos are read from and written to your own folders, and everything works offline. The DMG and Homebrew builds ask GitHub for updates on launch and download one only when you install it. The Mac App Store build makes no network requests.",
  },
  {
    question: "Who is Photopipe for, and who makes it?",
    answer:
      "Photographers who come home with hundreds or thousands of raws and want to pick and edit the keepers in one place. Raphael Mitas built it for his own dance event shoots, 2000 to 3000 raws a night.",
  },
];
