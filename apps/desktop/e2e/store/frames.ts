export type Device = "mac" | "ipad";

export type Size = { width: number; height: number };

export const SIZES: Record<Device, Size> = {
  mac: { width: 2880, height: 1800 },
  ipad: { width: 2732, height: 2048 },
};

export type Capture =
  | "loupe-DSC03455"
  | "loupe-DSC04417"
  | "nature-keepers-selected"
  | "nature-grid-instinct-3up"
  | "nature-export"
  | "ipad-editor";

type Image = { src: string; pos: string };

export type Frame = {
  layout: string;
  h1: string;
  sub?: string;
  fine?: string;
  eyebrow?: boolean;
  bg: Image;
  panel?: Image;
  scrim?: string;
  capture?: Capture;
  // a crop of the capture, scaled up and outlined on top of the window
  callout?: {
    crop: { x: number; y: number; w: number; h: number };
    scale: number;
    left: string;
    top: string;
  };
  tiles?: { label: string; src: string }[];
  before?: string;
  vars: Record<string, string>;
};

const render = (name: string) => `renders/${name}.jpg`;

export function frames(device: Device): Frame[] {
  const mac = device === "mac";
  const side = mac
    ? { pad: "120px", h1: "150px", sub: "46px" }
    : { pad: "110px", h1: "140px", sub: "44px" };
  const panel = mac
    ? {
        pad: "110px",
        "panel-w": "1080px",
        "copy-w": "1600px",
        "win-w": "1650px",
        h1: "132px",
        "sub-w": "1560px",
        sub: "44px",
        "copy-top": "120px",
        "win-top": "650px",
      }
    : {
        pad: "100px",
        "panel-w": "1040px",
        "copy-w": "1540px",
        "win-w": "1560px",
        h1: "128px",
        "sub-w": "1500px",
        sub: "42px",
        "copy-top": "130px",
        "win-top": "760px",
      };
  return [
    {
      layout: "left",
      eyebrow: true,
      h1: "Cull fast.<br>Edit RAW.<br><em>Deliver.</em>",
      sub: mac
        ? "Photo culling and RAW editing for your Mac."
        : "Photo culling and RAW editing for iPad.",
      bg: { src: render("DSC04450"), pos: "50% 40%" },
      scrim:
        "linear-gradient(90deg, rgba(6,8,14,.74) 0%, rgba(6,8,14,.45) 30%, rgba(6,8,14,0) 52%), linear-gradient(0deg, rgba(6,8,14,.35), rgba(6,8,14,0) 40%)",
      capture: "loupe-DSC03455",
      vars: mac
        ? {
            pad: "110px",
            "pad-r": "64px",
            "copy-w": "820px",
            "win-w": "1880px",
            h1: "178px",
            sub: "68px",
            "sub-w": "800px",
            "win-top": "54%",
          }
        : {
            pad: "110px",
            "pad-r": "60px",
            "copy-w": "760px",
            "win-w": "1790px",
            h1: "166px",
            sub: "64px",
            "sub-w": "760px",
            "win-top": "53%",
          },
    },
    {
      layout: "panel side-left",
      h1: "146 frames. <em>34 keepers.</em>",
      sub: mac
        ? "The landscapes from a 1,083-frame trip, rated with the 1&nbsp;to&nbsp;5 keys. Ratings are standard XMP that Lightroom reads."
        : "The landscapes from a 1,083-frame trip, rated 1&nbsp;to&nbsp;5. Ratings are standard XMP that Lightroom reads.",
      bg: { src: render("DSC04233_bright"), pos: "50% 50%" },
      panel: { src: render("DSC04233_bright"), pos: "68% 50%" },
      capture: "nature-keepers-selected",
      callout: {
        crop: { x: 512, y: 80, w: 440, h: 80 },
        scale: 2,
        left: mac ? "1210px" : "1110px",
        top: mac ? "560px" : "665px",
      },
      vars: panel,
    },
    {
      layout: "left",
      h1: "Your strongest frames, <em>sorted up.</em>",
      sub: "Instinct scores every frame on device with Apple's Vision aesthetics model. A head start, not a verdict.",
      fine: "On the full 1,083-frame shoot, its top 50 held 2x the keeper rate.",
      bg: { src: render("DSC04432"), pos: "50% 40%" },
      scrim:
        "linear-gradient(90deg, rgba(5,8,16,.9) 0%, rgba(5,8,16,.78) 32%, rgba(5,8,16,.35) 60%, rgba(5,8,16,.2) 100%)",
      capture: "nature-grid-instinct-3up",
      vars: mac
        ? {
            ...side,
            "copy-w": "820px",
            "sub-w": "800px",
            "pad-r": "60px",
            "win-w": "1840px",
            "win-top": "380px",
            "win-shift": "0",
          }
        : {
            ...side,
            "copy-w": "760px",
            "sub-w": "740px",
            "pad-r": "60px",
            "win-w": "1680px",
            "win-top": "500px",
            "win-shift": "0",
            fine: "34px",
          },
    },
    {
      layout: "compare",
      h1: "The blue hour you actually saw.",
      sub: "Exposure, shadows, curves and dehaze, on the RAW.",
      bg: { src: render("DSC04417"), pos: "50% 40%" },
      capture: "loupe-DSC04417",
      tiles: [
        { label: "Before", src: render("DSC04417_before") },
        { label: "After", src: render("DSC04417") },
      ],
      vars: mac
        ? {
            pad: "110px",
            "copy-top": "100px",
            h1: "140px",
            "sub-w": "1800px",
            sub: "46px",
            "tile-w": "1000px",
            "tiles-top": "390px",
            "win-w": "1600px",
            "win-top": "577px",
          }
        : {
            pad: "100px",
            "copy-top": "190px",
            h1: "136px",
            "sub-w": "1800px",
            sub: "46px",
            "tile-w": "960px",
            "tiles-top": "560px",
            "win-w": "1522px",
            "win-top": "650px",
          },
    },
    {
      layout: "panel side-right",
      h1: "Hand over the keepers, <em>edits baked in.</em>",
      sub: mac
        ? "Full-res JPEGs or the originals byte for byte, to a folder or a zip."
        : "Full-res JPEGs or the originals byte for byte.",
      fine: "Works on the folders you already have. No catalogue, no account.",
      bg: { src: render("DSC04421_bright"), pos: "50% 50%" },
      // keeps the person in the middle of the panel
      panel: {
        src: render("DSC04421_bright"),
        pos: mac ? "34.8% 50%" : "36.1% 50%",
      },
      capture: "nature-export",
      vars: { ...panel, "win-top": mac ? "700px" : "780px" },
    },
  ];
}

export const CREATIVE_ASSETS: { file: string; size: Size; frame: Frame }[] = [
  {
    file: "header.png",
    size: { width: 3840, height: 1646 },
    frame: {
      layout: "wipe",
      h1: "The blue hour <em>you actually saw.</em>",
      bg: { src: render("DSC04417"), pos: "50% 40%" },
      before: render("DSC04417_before"),
      vars: { h1: "170px", "copy-bottom": "170px" },
    },
  },
  {
    file: "search.png",
    size: { width: 3840, height: 2560 },
    frame: {
      layout: "bleed",
      h1: "Edit RAW <em>on iPad.</em>",
      bg: { src: render("DSC04450"), pos: "50% 30%" },
      scrim: "rgba(6,8,14,.35)",
      capture: "ipad-editor",
      vars: {
        pad: "150px",
        "copy-top": "170px",
        h1: "230px",
        "win-left": "-120px",
        "win-top": "560px",
        "win-w": "3800px",
      },
    },
  },
];

/// Everything arrives as a URL, so the page needs no file access.
export function framePage(
  { width, height }: Size,
  frame: Frame,
  css: string,
  url: { photo: (src: string) => string; capture?: string; icon: string },
): string {
  const vars = {
    w: `${width}px`,
    h: `${height}px`,
    "bg-pos": frame.bg.pos,
    ...frame.vars,
  };
  const style = Object.entries(vars)
    .map(([key, value]) => `--${key}:${value}`)
    .join(";");
  const capture = url.capture;
  const callout = (c: NonNullable<Frame["callout"]>) =>
    `<div class="callout" style="left:${c.left};top:${c.top};width:${c.crop.w * c.scale}px;height:${c.crop.h * c.scale}px;background-image:url('${capture}');background-size:${width * c.scale}px auto;background-position:${-c.crop.x * c.scale}px ${-c.crop.y * c.scale}px"></div>`;
  const tiles = frame.tiles
    ? `<div class="tiles">${frame.tiles
        .map(
          (tile) =>
            `<figure class="tile"><img src="${url.photo(tile.src)}"><figcaption>${tile.label}</figcaption></figure>`,
        )
        .join("")}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body style="${style}"><div class="stage layout-${frame.layout}">
<div class="bg"><img src="${url.photo(frame.bg.src)}"></div>
${frame.panel ? `<div class="panel" style="--panel-pos:${frame.panel.pos}"><img src="${url.photo(frame.panel.src)}"></div>` : ""}
${frame.scrim ? `<div class="scrim" style="background:${frame.scrim}"></div>` : ""}
${capture ? `<div class="window"><img src="${capture}"></div>` : ""}
${frame.callout ? callout(frame.callout) : ""}
${tiles}
${frame.before ? `<div class="bg wipe"><img src="${url.photo(frame.before)}"></div><div class="divider"></div><span class="badge before">Before</span><span class="badge after">After</span>` : ""}
<div class="copy">
${frame.eyebrow ? `<div class="eyebrow"><img src="${url.icon}">Photopipe</div>` : ""}
<h1>${frame.h1}</h1>
${frame.sub ? `<p class="sub">${frame.sub}</p>` : ""}
${frame.fine ? `<p class="fine">${frame.fine}</p>` : ""}
</div></div></body></html>`;
}
