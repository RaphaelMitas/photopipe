import storeRenders from "../e2e/store/renders.json";
import storeShoots from "../e2e/store/shoots.json";
import {
  type CoreMethods,
  type Edit,
  type ExportProgress,
  editKey,
  type ImageFile,
  identityEdit,
  type Shoot,
} from "./lib/core";
import type { RootEntry } from "./lib/roots";
import { makeImage } from "./lib/test-image";

function image(
  shootPath: string,
  rel: string,
  overrides: Partial<ImageFile> = {},
): ImageFile {
  return makeImage(rel, {
    path: `${shootPath}/${rel}`,
    width: 7008,
    height: 4672,
    ...overrides,
  });
}

const zellImages: ImageFile[] = [
  image("/fake/2026-07-12_zell", "DSC00832.ARW", {
    width: 4672,
    height: 7008,
    score: 0.41,
  }),
  image("/fake/2026-07-12_zell", "DSC00832.jpg", {
    edit: { ...identityEdit, exposure: 0.5 },
    score: 0.62,
  }),
  image("/fake/2026-07-12_zell", "abends/DSC00938.ARW", {
    rating: 2,
    score: 0.74,
    captured: 1_783_884_667,
    exif: {
      shutter: 1 / 40,
      aperture: 2,
      iso: 6400,
      focal: 35,
      lens: "FE 35mm F1.8",
      body: "ILCE-7M4",
    },
  }),
  image("/fake/2026-07-12_zell", "abends/DSC00943.ARW", {
    width: 4672,
    height: 7008,
    score: -0.12,
  }),
];

const miscImages: ImageFile[] = [
  image("/fake/misc", "IMG_0001.ARW", {
    width: 4672,
    height: 7008,
    score: 0.33,
  }),
];

const bigPath = (i: number) =>
  `/fake/2026-08-01_dolomites/DSC0${String(1200 + i)}.ARW`;
// near-identical runs the stacking pass would find: 1200–1202, 1204–1205, 1206–1210
const bigStacks = [
  [0, 3],
  [4, 6],
  [6, 11],
];
const bigStackOf = (i: number) => {
  const run = bigStacks.find(([from, to]) => i >= from && i < to);
  return run ? bigPath(run[0]) : null;
};

const bigImages: ImageFile[] = Array.from({ length: 200 }, (_, i) =>
  image("/fake/2026-08-01_dolomites", `DSC0${String(1200 + i)}.ARW`, {
    width: i % 3 === 0 ? 4672 : 7008,
    height: i % 3 === 0 ? 7008 : 4672,
    score: 0.5 - (i % 37) / 50,
    captured: 1_786_000_000 + i,
    stack: bigStackOf(i),
  }),
);

const shoots: Shoot[] = [
  {
    name: "2026-07-12_zell",
    path: "/fake/2026-07-12_zell",
    day: "2026-07-12",
    imageCount: zellImages.length,
    notes: "Golden hour at the river",
    cover: null,
    coverPath: "/fake/2026-07-12_zell/DSC00832.jpg",
    indexed: true,
  },
  {
    name: "misc",
    path: "/fake/misc",
    day: null,
    imageCount: 1,
    notes: "",
    cover: null,
    coverPath: "/fake/misc/IMG_0001.ARW",
    indexed: true,
  },
  {
    name: "2026-08-01_dolomites",
    path: "/fake/2026-08-01_dolomites",
    day: "2026-08-01",
    imageCount: 200,
    notes: "Two days above Cortina",
    cover: null,
    coverPath: "/fake/2026-08-01_dolomites/DSC01200.ARW",
    indexed: true,
  },
];

const emptyShoots = new Set<string>();

type StorePhoto = Pick<
  ImageFile,
  "rel" | "rating" | "score" | "width" | "height" | "captured"
> & { stack?: string | null; preview?: string };
type StoreShoot = { notes: string; cover: string; photos: StorePhoto[] };
type StoreRender = { name: string; edit: Partial<Edit> };

// `?store` swaps the drawn library for the real photos in the App Store screenshots.
const storeFiles = import.meta.glob<string>("../e2e/store/*/*.jpg", {
  query: "?url",
  import: "default",
  eager: true,
});
const storeImages = new Map<string, ImageFile[]>();
// Another photo's preview, so frame 1's filmstrip shows landscapes, not more portraits.
const storePreviews = new Map<string, string>();
if (new URLSearchParams(location.search).has("store")) {
  const data: Record<string, StoreShoot> = storeShoots;
  const renders: StoreRender[] = storeRenders;
  const edits = new Map(renders.map((r) => [`${r.name}.ARW`, r.edit]));
  shoots.splice(0, shoots.length);
  for (const [name, shoot] of Object.entries(data)) {
    const path = `/fake/${name}`;
    storeImages.set(
      name,
      shoot.photos.map(({ preview, stack, ...p }) => {
        if (preview) storePreviews.set(`${path}/${p.rel}`, preview);
        return image(path, p.rel, {
          ...p,
          stack: stack ? `${path}/${stack}` : null,
          edit: { ...identityEdit, ...edits.get(p.rel) },
        });
      }),
    );
    shoots.push({
      name,
      path,
      day: name.slice(0, 10),
      imageCount: shoot.photos.length,
      notes: shoot.notes,
      cover: shoot.cover,
      coverPath: `${path}/${shoot.cover}`,
      indexed: true,
    });
  }
}

function storeSrc(path: string, edited: boolean): string | null {
  if (!storeImages.size) return null;
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const url =
    (edited && storeFiles[`../e2e/store/renders/${stem}.jpg`]) ||
    storeFiles[`../e2e/store/photos/${storePreviews.get(path) ?? stem}.jpg`];
  return url ? new URL(url, location.href).href : null;
}

function projectFields(params: {
  name: string;
  notes: string;
  day?: string | null;
}): Pick<Shoot, "name" | "path" | "day" | "notes"> {
  const name = params.name.trim();
  return {
    name,
    path: `/fake/${name}`,
    day: params.day ?? null,
    notes: params.notes,
  };
}

/// `?indexing=1` holds the library in the state it has right after a cold
/// start: every file listed, none of its metadata read yet.
const indexing = new URLSearchParams(location.search).get("indexing") === "1";

const allImages = () =>
  [zellImages, miscImages, bigImages, ...storeImages.values()].flat();

function imagesFor(shoot: string): ImageFile[] {
  if (emptyShoots.has(shoot)) return [];
  const real = storeImages.get(shoot);
  if (real) return real;
  if (shoot === "2026-07-12_zell") return zellImages;
  if (shoot === "2026-08-01_dolomites") return bigImages;
  return miscImages;
}

// Every photo is rated already, so sorting by Instinct works the moment a
// project opens. `?scoring` stretches a pass to three polls, which is how the
// progress line gets tested without a clock in every other spec.
const scorePolls = new Map<string, number>();
const SLOW_SCORING_POLLS = 3;

function scored(shoot: string) {
  const total = imagesFor(shoot).length;
  if (!location.search.includes("scoring")) {
    return { done: total, total, running: false };
  }
  const poll = (scorePolls.get(shoot) ?? 0) + 1;
  scorePolls.set(shoot, poll);
  if (poll >= SLOW_SCORING_POLLS) return { done: total, total, running: false };
  return {
    done: Math.floor((total * poll) / SLOW_SCORING_POLLS),
    total,
    running: true,
  };
}

const exportJobs = new Map<string, ExportProgress>();
const zipJobs = new Map<string, boolean>();

/// `?exportfails=N` makes the first N files of every export fail the way a
/// full-resolution render does, which a spec cannot otherwise reach.
const exportFails = Number(
  new URLSearchParams(location.search).get("exportfails") ?? 0,
);

function startJob(total: number, zip: boolean): ExportProgress {
  const job: ExportProgress = {
    id: String(exportJobs.size + 1),
    done: 0,
    failed: 0,
    total,
    running: true,
    cancelled: false,
    archiving: false,
    failures: [],
  };
  exportJobs.set(job.id, job);
  zipJobs.set(job.id, zip);
  return { ...job };
}

function advanceExport(id: string): ExportProgress {
  const job = exportJobs.get(id);
  if (!job) throw `unknown_export: ${id}`;
  // one photo per poll, so a spec can watch the bar move
  if (job.running) {
    if (job.failed < exportFails) {
      job.failed += 1;
      job.failures.push(`DSC0${1200 + job.failed}.ARW: encodeFailed`);
    } else {
      job.done += 1;
    }
    job.running = job.done + job.failed < job.total;
  }
  return job;
}

const scenario = new URLSearchParams(location.search).get("roots");
let roots: RootEntry[] =
  scenario === "stored" || scenario === "broken" || scenario === "unplugged"
    ? [{ path: "/fake", status: scenario === "stored" ? "ok" : scenario }]
    : [];

let picked: string | null = null;

function stringArg(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null || !(key in args)) return;
  const value: unknown = Reflect.get(args, key);
  return typeof value === "string" ? value : undefined;
}

// The store screenshots render the iPad's feature set from /?ipad.
const ipad = new URLSearchParams(window.location.search).has("ipad");

export const E2E_COMMANDS: Record<string, (args: unknown) => unknown> = {
  features: () => ({
    updater: false,
    zipExport: !ipad,
    photoLibrary: ipad,
    reveal: !ipad,
  }),
  pick_folder: (args) => {
    picked =
      stringArg(args, "title") === "Export to folder"
        ? "/fake/delivery"
        : "/fake";
    return picked;
  },
  pick_photos: () => [
    ...Array.from({ length: 5 }, (_, i) => `/fake/card/DSC0900${i + 1}.ARW`),
    "/fake/card/notes.txt",
  ],
  list_roots: () => roots,
  open_root: (args) => {
    const path = stringArg(args, "path");
    if (path === undefined) throw new Error("open_root needs a path");
    const stored = roots.find((root) => root.path === path);
    // the panel grants what was just picked in it, which revives a broken bookmark
    const granted = path === picked && stored?.status === "broken";
    if (stored && stored.status !== "ok" && !granted) {
      throw { kind: stored.status, message: `${stored.status}: ${path}` };
    }
    if (path === "/nonexistent")
      throw { kind: "missing", message: "no folder at /nonexistent" };
    roots = [
      { path, status: "ok" },
      ...roots.filter((root) => root.path !== path),
    ];
    return { path, shoots: shoots.length, files: 6, generation: 1 };
  },
  forget_root: (args) => {
    roots = roots.filter((root) => root.path !== stringArg(args, "path"));
  },
};

type CoreHandlers = {
  [K in keyof CoreMethods]: (
    params: CoreMethods[K]["params"],
  ) => CoreMethods[K]["result"];
};

const E2E_HANDLERS: CoreHandlers = {
  listShoots: () => ({
    shoots: shoots.map((shoot) => ({ ...shoot, indexed: !indexing })),
  }),
  listImages: (params) => ({
    images: imagesFor(params.shoot).map((image) => ({
      ...image,
      stack: image.stack ?? image.path,
      enriched: !indexing,
    })),
  }),
  scoreShoot: (params) => scored(params.shoot),
  stackShoot: (params) => {
    const total = imagesFor(params.shoot).length;
    return { done: total, total, running: false };
  },
  thumbnail: (params) => ({
    cachePath:
      storeSrc(params.path, false) ?? `/fake/thumbs/${params.path}.jpg`,
  }),
  render: ({ path, edit, viewport }) => {
    const real = storeSrc(path, editKey(edit) !== editKey(identityEdit));
    if (real) return { cachePath: real };
    const region = viewport
      ? `@${viewport.left},${viewport.top},${viewport.right},${viewport.bottom}`
      : "";
    return { cachePath: `/fake/renders/${editKey(edit)}${region}/${path}.jpg` };
  },
  setRating: (params) => {
    const target = allImages().find((entry) => entry.path === params.path);
    if (!target) throw `unknown_image: ${params.path}`;
    target.rating = params.rating;
    return { rating: target.rating };
  },
  setFlag: (params) => {
    const target = allImages().find((entry) => entry.path === params.path);
    if (!target) throw `unknown_image: ${params.path}`;
    target.flag = params.flag;
    return { flag: target.flag };
  },
  setEdit: (params) => {
    const target = allImages().find((entry) => entry.path === params.path);
    if (!target) throw `unknown_image: ${params.path}`;
    target.edit = params.edit;
    return { edit: target.edit };
  },
  rawDefaults: (params) =>
    params.path.toLowerCase().endsWith(".arw")
      ? { temperature: 5250, tint: 8, denoise: 38 }
      : { temperature: null, tint: null, denoise: null },
  decoderAvailability: () => ({ raw9: true }),
  // misc stands in for the older body that tops out at RAW 8
  decoderSupport: (params) => {
    const raws = params.paths.filter((path) =>
      path.toLowerCase().endsWith(".arw"),
    );
    return {
      raw9: raws.filter((path) => !path.startsWith("/fake/misc")).length,
      rawTotal: raws.length,
    };
  },
  trash: (params) => {
    const paths = new Set(params.paths);
    let files = 0;
    for (const list of [zellImages, miscImages, bigImages]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (paths.has(list[i].path)) {
          files += 1;
          list.splice(i, 1);
        }
      }
    }
    return { files, generation: 1 };
  },
  exportFiles: (params) => startJob(params.paths.length, params.zip),
  exportStatus: (params) => advanceExport(params.id),
  cancelExport: (params) => {
    const job = advanceExport(params.id);
    if (job.running) {
      job.cancelled = true;
      job.running = false;
      // Staging goes with it, so a cancelled zip delivered nothing at all.
      if (zipJobs.get(job.id)) {
        job.done = 0;
        job.failed = 0;
        job.failures = [];
      }
    }
    return { ...job };
  },
  importFiles: (params) =>
    startJob(
      params.paths.filter((path) => /\.(arw|dng|jpe?g|png)$/i.test(path))
        .length,
      false,
    ),
  createProject: (params) => {
    const fields = projectFields(params);
    if (shoots.some((existing) => existing.name === fields.name)) {
      throw `project_exists: ${fields.name}`;
    }
    shoots.unshift({
      ...fields,
      imageCount: 0,
      cover: null,
      coverPath: null,
      indexed: true,
    });
    emptyShoots.add(fields.name);
    return { shoot: fields.name, path: fields.path, generation: 1 };
  },
  updateProject: (params) => {
    const shoot = shoots.find((s) => s.name === params.shoot);
    if (!shoot) throw `unknown_shoot: ${params.shoot}`;
    const fields = projectFields(params);
    if (
      fields.name !== shoot.name &&
      shoots.some((existing) => existing.name === fields.name)
    ) {
      throw `project_exists: ${fields.name}`;
    }
    Object.assign(shoot, fields);
    shoot.cover = params.cover;
    const match = imagesFor(shoot.name).find(
      (entry) => entry.rel === shoot.cover,
    );
    shoot.coverPath = match?.path ?? imagesFor(shoot.name)[0]?.path ?? null;
    return { shoot: shoot.name, generation: 1 };
  },
  captureDate: () => ({ day: "2026-07-12" }),
  rescan: () => ({}),
  status: () => ({
    generation: 1,
    root: "/fake",
    shoots: shoots.length,
    scanning: indexing,
    filesFound: 41203,
    filesEnriched: indexing ? 12800 : 41203,
    changedShoots: [],
  }),
};

type CoreRequest<K extends keyof CoreMethods = keyof CoreMethods> = {
  [M in K]: { method: M; params: CoreMethods[M]["params"] };
}[K];

/// Only `coreRequest` sends these, and it typed the params on the way out.
export function isCoreRequest(args: unknown): args is CoreRequest {
  return (
    typeof args === "object" &&
    args !== null &&
    "method" in args &&
    typeof args.method === "string" &&
    args.method in E2E_HANDLERS
  );
}

export function answerCoreRequest<K extends keyof CoreMethods>(
  request: CoreRequest<K>,
): CoreMethods[K]["result"] {
  return E2E_HANDLERS[request.method](request.params);
}
