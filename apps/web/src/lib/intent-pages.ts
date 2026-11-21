import type { ScreenshotName } from "@/components/Screenshot";
import type { FaqItem } from "@/lib/faq";

export type IntentPage = {
  slug: string;
  updated: string;
  rival: string;
  whyThisRival: string;
  title: string;
  description: string;
  headline: string;
  lede: string;
  screenshot: { name: ScreenshotName; alt: string };
  comparison: { feature: string; photopipe: string; rival: string }[];
  pick: { photopipe: string[]; rival: string[]; keepingRival: string };
  related: { lead: string; label: string; slug: string };
  workflow: { title: string; steps: { title: string; body: string }[] };
  faqTitle: string;
  faq: FaqItem[];
};

export const INTENT_PAGES: IntentPage[] = [
  {
    slug: "lightroom-alternative",
    updated: "2026-11-21",
    rival: "Lightroom Classic",
    whyThisRival:
      "Lightroom Classic is the raw editor most photographers measure the others against.",
    title: "Free Lightroom alternative for Mac",
    description:
      "A free Lightroom alternative for Mac and iPad: open source raw editing and culling with no subscription or catalogue. Edits save as XMP that Lightroom reads.",
    headline: "Cull and edit a shoot without the subscription.",
    lede: "A free raw editor and culling app for Mac with no catalogue and no subscription. Ratings and edits save as XMP that Lightroom reads, so you can try it on a real shoot and still finish there.",
    screenshot: {
      name: "develop",
      alt: "Photopipe's edit panel beside a blue hour raw, with the photo before and after the edit",
    },
    comparison: [
      {
        feature: "Price",
        photopipe: "Free and open source (MIT)",
        rival: "Adobe subscription",
      },
      {
        feature: "Getting photos in",
        photopipe: "Open a folder. No import, no catalogue",
        rival: "Import into a catalogue",
      },
      {
        feature: "Where your work is stored",
        photopipe: "XMP beside or inside each file",
        rival: "In the catalogue, written to XMP when you ask",
      },
      {
        feature: "AI culling",
        photopipe: "Instinct, its on-device AI, scores every frame 0 to 100",
        rival: "Assisted Culling checks focus, eyes and similar frames",
      },
      {
        feature: "Tone, colour and curves",
        photopipe:
          "Tone and presence sliders, white balance, vibrance, saturation, curves and denoise",
        rival: "The same, plus HSL, colour grading and profiles",
      },
      {
        feature: "Masks",
        photopipe:
          "Subject, people, background or a clicked object, on macOS 27",
        rival: "Those, plus brushes, gradients and range masks",
      },
      {
        feature: "Presets and lens corrections",
        photopipe: "Not yet",
        rival: "Yes",
      },
      {
        feature: "Organising",
        photopipe: "Folders, stars, pick and reject flags",
        rival: "Keywords, collections, people and map",
      },
      {
        feature: "Export",
        photopipe: "Originals or full-resolution JPEG, to a folder or a zip",
        rival: "JPEG, TIFF, DNG and PSD, print and publish services",
      },
      {
        feature: "Runs on",
        photopipe: "Apple Silicon Mac and iPad",
        rival: "Mac and Windows",
      },
      {
        feature: "Account",
        photopipe: "None, and no telemetry",
        rival: "Adobe account",
      },
    ],
    pick: {
      photopipe: [
        "You come home with a card full of raws and want the keepers out tonight.",
        "You do not want another subscription.",
        "You want your photos in plain folders that any app can read.",
      ],
      rival: [
        "You retouch with brushes and gradients, or rely on presets and lens profiles.",
        "You search years of work by keyword, collection or person.",
        "You are on Windows or an Intel Mac.",
      ],
      keepingRival:
        "Keeping Lightroom? Photopipe can still do the cull, and the stars travel as XMP.",
    },
    related: {
      lead: "Only need to cull before Lightroom?",
      label: "Photopipe as a Photo Mechanic alternative",
      slug: "photo-mechanic-alternative",
    },
    workflow: {
      title: "From card to Lightroom in four steps.",
      steps: [
        {
          title: "Open the folder",
          body: "Point Photopipe at the folder the shoot is in. Nothing is imported or copied.",
        },
        {
          title: "Let Instinct sort it",
          body: "A background pass scores every frame from 0 to 100 on your Mac. Sort by it and the stronger frames come first.",
        },
        {
          title: "Rate and rough in the edit",
          body: "Stars on 1 to 5 in a full-screen view, then exposure, white balance and curves on the keepers. Every decision is written as XMP beside the raw.",
        },
        {
          title: "Finish in Lightroom",
          body: "Import the same folder into Lightroom Classic. It reads the stars and the edits from the XMP, and its brushes, presets and lens profiles are there for the frames that need them.",
        },
      ],
    },
    faqTitle: "Coming from Lightroom, answered.",
    faq: [
      {
        question: "Can I use Photopipe and Lightroom together?",
        answer:
          "Yes. Photopipe writes star ratings and edits as XMP, with the edits in the same fields Lightroom uses, so Lightroom Classic reads them from the file. Cull and rough in the edit in Photopipe, then open the keepers in Lightroom for the work Photopipe does not do. Masks are the exception: Lightroom does not see a mask made in Photopipe.",
      },
      {
        question: "Do I have to import my photos first?",
        answer:
          "No. Photopipe has no catalogue. Point it at a folder and it shows what is there, and when you move a file in Finder it moves in the app.",
      },
      {
        question: "What does Lightroom do that Photopipe does not?",
        answer:
          "Brushes and gradients, HSL, presets, lens correction controls, a catalogue with keywords and collections, tethering and printing. Photopipe also has no Windows or Intel version. If your work depends on those, keep Lightroom. Because ratings and edits travel as XMP, you can still do the cull in Photopipe.",
        link: {
          href: "/free-photo-culling-software",
          label: "Free AI photo culling, compared",
        },
      },
      {
        question: "How is Photopipe different from darktable or RawTherapee?",
        answer:
          "darktable and RawTherapee are free and open source, run on Windows, Linux and Mac, and have deeper editing tools than Photopipe. Photopipe is narrower and built for one job: open a folder, cull it from the keyboard with an AI first sort, and edit the keepers in a native Mac and iPad app. It is free for paid work too, with no paid tier and no account, and its edits are written in the fields Lightroom reads.",
      },
    ],
  },
  {
    slug: "photo-mechanic-alternative",
    updated: "2026-11-21",
    rival: "Photo Mechanic",
    whyThisRival: "Photo Mechanic is the benchmark for culling a card fast.",
    title: "Free Photo Mechanic alternative for Mac",
    description:
      "A free Photo Mechanic alternative for Mac and iPad: rate from the keyboard, let on-device AI sort the shoot, then edit the raws in the same app.",
    headline: "Cull the shoot, then edit it in the same app.",
    lede: "A keyboard-driven culling app with a raw editor in the same view. Rate with 1 to 5, flag with P and X, and develop the keepers without leaving the app. It is free, and Photo Mechanic reads the stars it writes.",
    screenshot: {
      name: "cull",
      alt: "Culling a shoot in Photopipe: 34 keepers selected out of 146 frames",
    },
    comparison: [
      {
        feature: "Price",
        photopipe: "Free and open source (MIT)",
        rival: "Paid, by subscription or one-time licence",
      },
      {
        feature: "Browsing speed",
        photopipe:
          "Renders the raw itself, slower on a photo it has not shown yet",
        rival: "Near instant, from the camera's embedded JPEG",
      },
      {
        feature: "Culling",
        photopipe:
          "Full-screen view, stars on 1 to 5, pick and reject flags, and a burst of near-identical frames judged as one",
        rival: "Embedded JPEG previews, stars, colour classes and tags",
      },
      {
        feature: "AI ranking",
        photopipe: "Instinct, its on-device AI, scores every frame 0 to 100",
        rival: "None",
      },
      {
        feature: "Raw editing",
        photopipe: "Tone, colour, curves, denoise, crop and masks",
        rival: "None. It shows the camera's embedded JPEG",
      },
      {
        feature: "Captions and IPTC",
        photopipe: "Stars and flags only",
        rival: "Templates, keywords and code replacements",
      },
      {
        feature: "Ingest",
        photopipe: "Opens the folder you already have",
        rival: "Several cards at once, with rename and backup",
      },
      {
        feature: "Delivery",
        photopipe: "Originals or full-resolution JPEG, to a folder or a zip",
        rival: "FTP and upload services",
      },
      {
        feature: "Runs on",
        photopipe: "Apple Silicon Mac and iPad",
        rival: "Mac and Windows",
      },
    ],
    pick: {
      photopipe: [
        "You cull and edit the same shoot and want one app for both.",
        "You shoot events in bursts and want to judge a moment once, not six times.",
        "You would rather not buy a licence to rate photos.",
      ],
      rival: [
        "You file on deadline and need captions, IPTC templates and FTP.",
        "You ingest several cards at once with renaming and a backup copy.",
        "You are on Windows or an Intel Mac.",
      ],
      keepingRival:
        "Keeping Photo Mechanic for filing? Photopipe can still edit the picks.",
    },
    related: {
      lead: "Want the software to sort the shoot first?",
      label: "Free AI culling in Photopipe",
      slug: "free-photo-culling-software",
    },
    workflow: {
      title: "A shoot in Photopipe, start to finish.",
      steps: [
        {
          title: "Open the folder",
          body: "Point Photopipe at the shoot, or at a folder you already ingested with Photo Mechanic. It shows what is on disk, subfolders included, with no ingest step.",
        },
        {
          title: "Walk it once",
          body: "Arrow keys move, 1 to 5 rate, P and X flag. With Stacks on, a burst of near-identical frames is one step, so you judge the moment once.",
        },
        {
          title: "Edit the keepers where you are",
          body: "The loupe you cull in is the editor. Exposure sits on the up and down arrows, the rest in the panel beside the photo.",
        },
        {
          title: "Deliver",
          body: "Export full-resolution JPEGs to a folder or a zip, or hand the folder on. The stars are XMP that Photo Mechanic and Lightroom read.",
        },
      ],
    },
    faqTitle: "Coming from Photo Mechanic, answered.",
    faq: [
      {
        question: "Does Photopipe edit raw files?",
        answer:
          "Yes, and that is the main difference. The loupe you cull in is also the editor: tone, colour, curves, denoise on the Neural Engine and crop, plus masks on macOS 27. Edits are saved as XMP and baked into JPEG exports.",
        link: {
          href: "/lightroom-alternative",
          label: "Photopipe and Lightroom compared",
        },
      {
        question: "Is Photopipe as fast as Photo Mechanic?",
        answer:
          "Photo Mechanic shows the camera's embedded JPEG and is the benchmark for flipping through a card. Photopipe renders the raw itself: the loupe shows a thumbnail at once, replaces it with the rendered raw and prefetches the neighbours. It is slower on a cold photo, and what you judge is the photo you will edit, not the camera's JPEG.",
      },
      {
        question: "Does Photo Mechanic read Photopipe's ratings?",
        answer:
          "Yes. Stars are written as standard XMP, a sidecar beside a raw or embedded in a DNG, JPEG or PNG. Photo Mechanic, Lightroom Classic and Capture One read the same stars.",
      },
      {
        question: "Why not Adobe Bridge?",
        answer:
          "Bridge is free with an Adobe account and rates quickly from the camera's previews, but it has no AI sort and leaves raw editing to Camera Raw, which needs a paid Adobe app. Photopipe needs no account, sorts the shoot on your Mac and edits the keepers in the same view. Neither has Photo Mechanic's captions, IPTC templates or code replacements.",
      },
      },
    ],
  },
  {
    slug: "free-photo-culling-software",
    updated: "2026-11-21",
    rival: "Aftershoot",
    whyThisRival:
      "Aftershoot is one of the best-known AI cullers, so it is the yardstick here.",
    title: "Free AI photo culling software for Mac",
    description:
      "Free AI photo culling software for Mac and iPad: on-device scoring with no photo limit, no account and a raw editor built in.",
    headline: "Free culling, with the AI on your Mac.",
    lede: "A free photo culling app that scores every frame on your Mac and sorts the stronger ones first. There is no photo limit, no project limit and no account, and you edit and export the keepers in the same app.",
    screenshot: {
      name: "instinct",
      alt: "The Photopipe grid sorted by its on-device AI score, the strongest frames first",
    },
    comparison: [
      {
        feature: "Price",
        photopipe: "Free, with no limit on photos or projects",
        rival: "Subscription, after a free trial",
      },
      {
        feature: "What the AI does",
        photopipe: "One score per frame, 0 to 100, to sort by",
        rival: "Groups duplicates, checks eyes and focus, makes the selection",
      },
      {
        feature: "Who decides",
        photopipe: "You. Nothing is rejected or deleted for you",
        rival: "The app selects, you review",
      },
      {
        feature: "Bursts",
        photopipe:
          "A burst of near-identical frames is judged once, as a stack",
        rival: "Duplicates grouped, with a suggested best frame",
      },
      {
        feature: "Where it runs",
        photopipe: "On your Mac, offline, with no account",
        rival: "On your computer, with an account",
      },
      {
        feature: "Editing",
        photopipe: "Raw editor built in",
        rival: "AI editing as a separate plan, or a hand-off to Lightroom",
      },
      {
        feature: "Runs on",
        photopipe: "Apple Silicon Mac and iPad",
        rival: "Mac and Windows",
      },
    ],
    pick: {
      photopipe: [
        "You want a sorted starting point and prefer to make the picks yourself.",
        "Your photos should stay on your Mac, and you do not want an account.",
        "You cull a few shoots a year and a subscription makes no sense.",
      ],
      rival: [
        "You shoot weddings by the thousand and want closed eyes and missed focus caught for you.",
        "You want the software to make the first selection, not only sort it.",
        "You are on Windows or an Intel Mac.",
      ],
      keepingRival:
        "Keeping Aftershoot for the cull? Photopipe can still edit the keepers.",
    },
    related: {
      lead: "Rather cull by hand, without the AI?",
      label: "Photopipe as a Photo Mechanic alternative",
      slug: "photo-mechanic-alternative",
    },
    workflow: {
      title: "Cull a shoot in four steps.",
      steps: [
        {
          title: "Open the folder",
          body: "Scoring starts in the background as soon as the shoot is open, with no upload and no account. Already culled in Aftershoot? Open that folder and go straight to step 4.",
        },
        {
          title: "Sort by Instinct",
          body: "Instinct, the on-device AI, gives every frame one score from 0 to 100. Sort by it and start at the strong end of the shoot, not at frame one.",
        },
        {
          title: "Rate from the keyboard",
          body: "1 to 5 for stars, P and X for pick and reject. The rating histogram is the filter: click a bar to see only those frames.",
        },
        {
          title: "Edit and export the keepers",
          body: "Develop them in the same app and export full-resolution JPEGs, or leave the stars in XMP for Lightroom.",
        },
      ],
    },
    faqTitle: "Free culling, answered.",
    faq: [
      {
        question: "How good is the AI?",
        answer:
          "Instinct is a first sort, not a judge. It uses Apple's Vision aesthetics model to give each frame one score, and sorting by it brings the stronger frames to the top. It does not check for closed eyes or missed focus, and inside a burst it does not choose the frame for you. Aftershoot, Narrative Select and FilterPixel do that work, on paid plans or on free plans with limits.",
      },
      {
        question: "How is Photopipe different from other free culling apps?",
        answer:
          "Many free AI cullers are the free plan of a paid product, with an account and a cap on photos, projects or AI use. Free viewers such as Adobe Bridge or digiKam rate and compare but do not score frames. Photopipe is the whole app with nothing to upgrade to: on-device scoring, keyboard culling and a raw editor, under the MIT licence.",
      },
      {
        question: "Is there a limit on photos or projects?",
        answer:
          "No. Photopipe is free with no photo count, no project count, no trial and no account. The source code is on GitHub under the MIT licence.",
      },
      {
        question: "Does Photopipe upload my photos to score them?",
        answer:
          "No. Scoring runs on your Mac with Apple's Vision framework, straight from the raw file, and it works offline.",
      },
      {
        question: "Can I finish in Lightroom after culling?",
        answer:
          "Yes. Star ratings are written as XMP, a sidecar beside a raw or embedded in a DNG, JPEG or PNG, and Lightroom Classic, Capture One and Photo Mechanic read them.",
        link: {
          href: "/lightroom-alternative",
          label: "Photopipe as a free Lightroom alternative",
        },
      },
      {
        question: "Can Photopipe delete the rejects?",
        answer:
          "Only when you ask. X flags a frame as a reject and it stays where it is. When the pass is done you can send every reject to the Trash in one step, behind a confirm, with its XMP sidecar.",
      },
    ],
  },
];
