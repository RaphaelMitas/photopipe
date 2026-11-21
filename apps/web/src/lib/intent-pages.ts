import type { ScreenshotName } from "@/components/Screenshot";
import type { FaqItem } from "@/lib/faq";

export type IntentPage = {
  slug: string;
  rival: string;
  title: string;
  description: string;
  headline: string;
  lede: string;
  screenshot: { name: ScreenshotName; alt: string };
  comparison: { feature: string; photopipe: string; rival: string }[];
  pick: { photopipe: string[]; rival: string[] };
  faq: FaqItem[];
};

export const INTENT_PAGES: IntentPage[] = [
  {
    slug: "lightroom-alternative",
    rival: "Lightroom Classic",
    title: "Free Lightroom alternative for Mac",
    description:
      "Photopipe is a free, open source raw editor and culling app for Mac. No subscription and no catalogue, and its edits save as XMP that Lightroom reads.",
    headline: "Cull and edit a shoot without the subscription.",
    lede: "Photopipe opens a folder of raws, ranks it on your Mac and gives you tone, colour, curves, denoise and crop in one free app. Ratings and edits are saved as XMP in Lightroom's own tags, so you can try it on a real shoot and still finish in Lightroom.",
    screenshot: {
      name: "develop",
      alt: "A blue hour raw before and after its edit, beside the Photopipe loupe with the edit panel open",
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
        photopipe: "Instinct scores every frame 0 to 100, on device",
        rival: "Assisted Culling checks focus, eyes and similar frames",
      },
      {
        feature: "Tone, colour and curves",
        photopipe:
          "Exposure through dehaze, white balance, vibrance, saturation, RGB and channel curves",
        rival: "The same, plus HSL, colour grading and profiles",
      },
      {
        feature: "Masks",
        photopipe:
          "Subject, people, background or a clicked object, on macOS 27",
        rival: "Those, plus brushes, gradients and range masks",
      },
      {
        feature: "Denoise",
        photopipe: "On the Neural Engine, for raw files",
        rival: "AI Denoise",
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
    },
    faq: [
      {
        question: "Can I use Photopipe and Lightroom together?",
        answer:
          "Yes. Photopipe writes star ratings and edits as XMP, with the edits in Lightroom's own crs tags such as crs:Exposure2012, so Lightroom Classic reads them from the file. Cull and rough in the edit in Photopipe, then open the keepers in Lightroom for the work Photopipe does not do. Masks are the exception: Lightroom does not see a mask made in Photopipe.",
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
      },
      {
        question: "Is Photopipe free for paid work?",
        answer:
          "Yes. There is no paid tier, no trial and no account, and nothing limits what you shoot or deliver with it. The source code is on GitHub under the MIT licence.",
      },
    ],
  },
  {
    slug: "photo-mechanic-alternative",
    rival: "Photo Mechanic",
    title: "Free Photo Mechanic alternative for Mac",
    description:
      "Photopipe is a free culling app for Mac with a raw editor built in. Rate from the keyboard, let on-device AI sort the shoot, and export without a second app.",
    headline: "Cull the shoot, then edit it in the same app.",
    lede: "Photopipe is a keyboard-driven culling app with a raw editor behind the same loupe. Rate with 1 to 5, flag with P and X, walk a burst as one stop, and develop the keepers without sending them anywhere. It is free, and Photo Mechanic reads the stars it writes.",
    screenshot: {
      name: "cull",
      alt: "A Photopipe grid with 34 keepers selected out of 146 frames",
    },
    comparison: [
      {
        feature: "Price",
        photopipe: "Free and open source (MIT)",
        rival: "Paid, by subscription or one-time licence",
      },
      {
        feature: "Culling",
        photopipe:
          "Full-bleed loupe, stars on 1 to 5, pick and reject flags, bursts walked as one stop",
        rival: "Embedded JPEG previews, stars, colour classes and tags",
      },
      {
        feature: "AI ranking",
        photopipe: "Instinct scores every frame 0 to 100, on device",
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
    },
    faq: [
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
        question: "Can Photopipe caption or keyword photos?",
        answer:
          "No. It writes star ratings, flags and edits, and has no IPTC captions, keywords or code replacements. For wire and agency work Photo Mechanic is the right tool.",
      },
    ],
  },
  {
    slug: "free-photo-culling-software",
    rival: "Aftershoot",
    title: "Free photo culling software for Mac",
    description:
      "Photopipe is free photo culling software for Mac with no photo limit and no account. On-device AI scores every frame, and a raw editor is built in.",
    headline: "Free culling, with the AI on your Mac.",
    lede: "Photopipe scores every frame of a shoot on your Mac, sorts the stronger ones first and lets you rate the rest from the keyboard. There is no photo limit, no project limit and no account, and you edit and export the keepers in the same app.",
    screenshot: {
      name: "instinct",
      alt: "The Photopipe grid sorted by Instinct score, the strongest frames first",
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
        photopipe: "Stacks walk near-identical frames as one stop",
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
        "You are on Windows.",
      ],
    },
    faq: [
      {
        question: "How good is the AI?",
        answer:
          "Instinct is a first sort, not a judge. It uses Apple's Vision aesthetics model to give each frame one score, and sorting by it brings the stronger frames to the top. It does not check for closed eyes or missed focus, and inside a burst it does not choose the frame for you. Aftershoot, Narrative Select and FilterPixel do that work for a subscription.",
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
      },
    ],
  },
];
