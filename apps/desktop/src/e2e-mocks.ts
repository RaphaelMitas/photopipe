// Fake core dataset for Playwright runs (VITE_E2E=1). Only imported there.
import type { ImageGroup, Shoot } from "./lib/core";

const zellImages: ImageGroup[] = [
  {
    stem: "DSC00832",
    stage: "export",
    rating: 0,
    width: 4672,
    height: 7008,
    files: [
      {
        path: "/fake/z/DSC00832.ARW",
        ext: "ARW",
        stage: "raw",
        size: 1,
        mtime: 1,
      },
      {
        path: "/fake/z/DSC00832.dng",
        ext: "dng",
        stage: "denoised",
        size: 1,
        mtime: 2,
      },
      {
        path: "/fake/z/DSC00832.jpg",
        ext: "jpg",
        stage: "export",
        size: 1,
        mtime: 3,
      },
    ],
  },
  {
    stem: "DSC00938",
    stage: "denoised",
    rating: 2,
    width: 7008,
    height: 4672,
    files: [
      {
        path: "/fake/z/DSC00938.ARW",
        ext: "ARW",
        stage: "raw",
        size: 1,
        mtime: 1,
      },
      {
        path: "/fake/z/DSC00938.dng",
        ext: "dng",
        stage: "denoised",
        size: 1,
        mtime: 2,
      },
    ],
  },
  {
    stem: "DSC00943",
    stage: "raw",
    rating: 0,
    width: 4672,
    height: 7008,
    files: [
      {
        path: "/fake/z/DSC00943.ARW",
        ext: "ARW",
        stage: "raw",
        size: 1,
        mtime: 1,
      },
    ],
  },
  {
    stem: "DSC00953",
    stage: "raw",
    rating: 0,
    width: 7008,
    height: 4672,
    files: [
      {
        path: "/fake/z/DSC00953.ARW",
        ext: "ARW",
        stage: "raw",
        size: 1,
        mtime: 1,
      },
    ],
  },
];

const shoots: Shoot[] = [
  {
    name: "2026-07-12_zell",
    path: "/fake/2026-07-12_zell",
    day: "2026-07-12",
    project: "zell",
    counts: { raw: 2, denoised: 1, export: 1 },
    imageCount: 4,
    notes: "Golden hour at the river",
    cover: null,
    coverPath: "/fake/z/DSC00832.jpg",
  },
  {
    name: "misc",
    path: "/fake/misc",
    day: null,
    project: null,
    counts: { raw: 1, denoised: 0, export: 0 },
    imageCount: 1,
    notes: "",
    cover: null,
    coverPath: "/fake/misc/IMG_0001.ARW",
  },
];

const miscImages: ImageGroup[] = [
  {
    stem: "IMG_0001",
    stage: "raw",
    rating: 0,
    width: 4672,
    height: 7008,
    files: [
      {
        path: "/fake/misc/IMG_0001.ARW",
        ext: "ARW",
        stage: "raw",
        size: 1,
        mtime: 1,
      },
    ],
  },
];

/// A shoot big enough that grid and filmstrip virtualization actually
/// virtualize (the small zell dataset mounts every cell).
const bigImages: ImageGroup[] = Array.from({ length: 200 }, (_, i) => ({
  stem: `BIG${String(i).padStart(5, "0")}`,
  stage: "raw" as const,
  rating: 0,
  width: i % 3 === 0 ? 4672 : 7008,
  height: i % 3 === 0 ? 7008 : 4672,
  files: [
    {
      path: `/fake/big/BIG${String(i).padStart(5, "0")}.ARW`,
      ext: "ARW",
      stage: "raw" as const,
      size: 1,
      mtime: 1,
    },
  ],
}));
shoots.push({
  name: "2026-08-01_big",
  path: "/fake/2026-08-01_big",
  day: "2026-08-01",
  project: "big",
  counts: { raw: 200, denoised: 0, export: 0 },
  imageCount: 200,
  notes: "",
  cover: null,
  coverPath: "/fake/big/BIG00000.ARW",
});

/// Projects created during the test run have no images.
const emptyShoots = new Set<string>();

function imagesFor(shoot: string): ImageGroup[] {
  if (emptyShoots.has(shoot)) return [];
  if (shoot === "2026-07-12_zell") return zellImages;
  if (shoot === "2026-08-01_big") return bigImages;
  return miscImages;
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
  listShoots: () => ({ shoots }),
  listImages: (params) => ({
    // A fresh array each call, like the real transport: returning the same
    // reference would let the query cache short-circuit and miss mutations.
    images: [...imagesFor(String(params.shoot))],
  }),
  thumbnail: (params) => ({
    cachePath: `/fake/thumbs/${String(params.path)}.jpg`,
  }),
  render: (params) => ({
    cachePath: `/fake/renders/${String(params.path)}@${String(params.exposure)}.jpg`,
  }),
  setRating: (params) => {
    const all = [...zellImages, ...miscImages, ...bigImages];
    const target = all.find((image) => image.stem === params.stem);
    if (!target) throw `unknown_image: ${String(params.stem)}`;
    target.rating = Number(params.rating);
    return { rating: target.rating, generation: 1 };
  },
  openIn: (params) => ({ opened: (params.paths as string[]).length }),
  reveal: () => ({ revealed: true }),
  trash: (params) => {
    const stems = new Set(params.stems as string[]);
    // Mirror the core: the whole lineage group goes.
    let files = 0;
    for (const list of [zellImages, miscImages, bigImages]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (stems.has(list[i].stem)) {
          files += list[i].files.length;
          list.splice(i, 1);
        }
      }
    }
    return { files, generation: 1 };
  },
  exportFiles: (params) => ({ files: (params.paths as string[]).length }),
  importFiles: (params) => ({
    imported: (params.paths as string[]).length,
    skipped: 0,
    generation: 1,
  }),
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
      counts: { raw: 0, denoised: 0, export: 0 },
      imageCount: 0,
      notes: String(params.notes ?? ""),
      cover: null,
      coverPath: null,
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
          (image) => image.stem === shoot.cover,
        );
        shoot.coverPath =
          match?.files[match.files.length - 1]?.path ??
          imagesFor(shoot.name)[0]?.files[0]?.path ??
          null;
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
  status: () => ({ generation: 1, root: "/fake", shoots: shoots.length }),
};
