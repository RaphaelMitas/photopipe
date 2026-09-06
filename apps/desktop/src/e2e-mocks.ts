import {
  type Edit,
  editKey,
  type ImageFile,
  identityEdit,
  type Shoot,
} from "./lib/core";
import type { ExportProgress } from "./lib/queries";
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

const bigImages: ImageFile[] = Array.from({ length: 200 }, (_, i) =>
  image("/fake/2026-08-01_dolomites", `DSC0${String(1200 + i)}.ARW`, {
    width: i % 3 === 0 ? 4672 : 7008,
    height: i % 3 === 0 ? 7008 : 4672,
    score: 0.5 - (i % 37) / 50,
  }),
);

const shoots: Shoot[] = [
  {
    name: "2026-07-12_zell",
    path: "/fake/2026-07-12_zell",
    day: "2026-07-12",
    project: "zell",
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
    project: null,
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
    project: "dolomites",
    imageCount: 200,
    notes: "Two days above Cortina",
    cover: null,
    coverPath: "/fake/2026-08-01_dolomites/DSC01200.ARW",
    indexed: true,
  },
];

const emptyShoots = new Set<string>();

/// `?indexing=1` holds the library in the state it has right after a cold
/// start: every file listed, none of its metadata read yet.
const indexing = new URLSearchParams(location.search).get("indexing") === "1";

function imagesFor(shoot: string): ImageFile[] {
  if (emptyShoots.has(shoot)) return [];
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
    error: null,
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

export const E2E_HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => unknown
> = {
  ping: () => ({ pong: true }),
  version: () => ({ version: "0.0.0-e2e", protocol: 1 }),
  setRoot: (params) => {
    if (params.path === "/nonexistent") throw "root_not_found: /nonexistent";
    return { shoots: shoots.length, files: 6, generation: 1 };
  },
  listShoots: () => ({
    shoots: shoots.map((shoot) => ({ ...shoot, indexed: !indexing })),
  }),
  listImages: (params) => ({
    images: imagesFor(String(params.shoot)).map((image) => ({
      ...image,
      enriched: !indexing,
    })),
  }),
  scoreShoot: (params) => scored(String(params.shoot)),
  scoreStatus: (params) => scored(String(params.shoot)),
  thumbnail: (params) => ({
    cachePath: `/fake/thumbs/${String(params.path)}.jpg`,
  }),
  render: (params) => {
    const viewport = params.viewport as
      | { left: number; top: number; right: number; bottom: number }
      | undefined;
    const region = viewport
      ? `@${viewport.left},${viewport.top},${viewport.right},${viewport.bottom}`
      : "";
    return {
      cachePath: `/fake/renders/${editKey(
        (params.edit as Edit | undefined) ?? identityEdit,
      )}${region}/${String(params.path)}.jpg`,
    };
  },
  setRating: (params) => {
    const all = [...zellImages, ...miscImages, ...bigImages];
    const target = all.find((entry) => entry.path === params.path);
    if (!target) throw `unknown_image: ${String(params.path)}`;
    target.rating = Number(params.rating);
    return { rating: target.rating, generation: 1 };
  },
  setEdit: (params) => {
    const all = [...zellImages, ...miscImages, ...bigImages];
    const target = all.find((entry) => entry.path === params.path);
    if (!target) throw `unknown_image: ${String(params.path)}`;
    target.edit = params.edit as Edit;
    return { edit: target.edit, generation: 1 };
  },
  rawDefaults: (params) =>
    String(params.path).toLowerCase().endsWith(".arw")
      ? { temperature: 5250, tint: 8, denoise: 38 }
      : { temperature: null, tint: null, denoise: null },
  decoderAvailability: () => ({ raw9: true }),
  // misc stands in for the older body that tops out at RAW 8
  decoderSupport: (params) => {
    const raws = (params.paths as string[]).filter((path) =>
      path.toLowerCase().endsWith(".arw"),
    );
    return {
      raw9: raws.filter((path) => !path.startsWith("/fake/misc")).length,
      rawTotal: raws.length,
    };
  },
  reveal: () => ({ revealed: true }),
  trash: (params) => {
    const paths = new Set(params.paths as string[]);
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
  exportFiles: (params) =>
    startJob((params.paths as string[]).length, params.zip === true),
  exportStatus: (params) => advanceExport(String(params.id)),
  cancelExport: (params) => {
    const job = advanceExport(String(params.id));
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
      (params.paths as string[]).filter((path) =>
        /\.(arw|dng|jpe?g|png)$/i.test(path),
      ).length,
      false,
    ),
  createProject: (params) => {
    const shoot = `${String(params.day)}_${String(params.name)}`;
    if (shoots.some((existing) => existing.name === shoot)) {
      throw `project_exists: ${shoot}`;
    }
    shoots.unshift({
      name: shoot,
      path: `/fake/${shoot}`,
      day: String(params.day),
      project: String(params.name),
      imageCount: 0,
      notes: String(params.notes ?? ""),
      cover: null,
      coverPath: null,
      indexed: true,
    });
    emptyShoots.add(shoot);
    return { shoot, path: `/fake/${shoot}`, generation: 1 };
  },
  updateProject: (params) => {
    const shoot = shoots.find((s) => s.name === params.shoot);
    if (shoot) {
      if (params.notes !== undefined) shoot.notes = String(params.notes);
      if ("cover" in params) {
        shoot.cover = (params.cover as string | null) ?? null;
        const match = imagesFor(shoot.name).find(
          (entry) => entry.rel === shoot.cover,
        );
        shoot.coverPath = match?.path ?? imagesFor(shoot.name)[0]?.path ?? null;
      }
    }
    return { generation: 1 };
  },
  renameProject: (params) => {
    const shoot = shoots.find((s) => s.name === params.shoot);
    const renamed = `${String(params.day)}_${String(params.name)}`;
    if (shoot) {
      shoot.name = renamed;
      shoot.day = String(params.day);
      shoot.project = String(params.name);
    }
    return { shoot: renamed, generation: 1 };
  },
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
