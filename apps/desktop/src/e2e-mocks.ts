import {
  type Edit,
  editKey,
  type ImageFile,
  identityEdit,
  type Shoot,
} from "./lib/core";
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
  }),
  image("/fake/2026-07-12_zell", "DSC00832.jpg", {
    edit: { ...identityEdit, exposure: 0.5 },
  }),
  image("/fake/2026-07-12_zell", "abends/DSC00938.ARW", { rating: 2 }),
  image("/fake/2026-07-12_zell", "abends/DSC00943.ARW", {
    width: 4672,
    height: 7008,
  }),
];

const miscImages: ImageFile[] = [
  image("/fake/misc", "IMG_0001.ARW", { width: 4672, height: 7008 }),
];

const bigImages: ImageFile[] = Array.from({ length: 200 }, (_, i) =>
  image("/fake/2026-08-01_dolomites", `DSC0${String(1200 + i)}.ARW`, {
    width: i % 3 === 0 ? 4672 : 7008,
    height: i % 3 === 0 ? 7008 : 4672,
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
  },
];

const emptyShoots = new Set<string>();

function imagesFor(shoot: string): ImageFile[] {
  if (emptyShoots.has(shoot)) return [];
  if (shoot === "2026-07-12_zell") return zellImages;
  if (shoot === "2026-08-01_dolomites") return bigImages;
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
    images: [...imagesFor(String(params.shoot))],
  }),
  thumbnail: (params) => ({
    cachePath: `/fake/thumbs/${String(params.path)}.jpg`,
  }),
  render: (params) => ({
    cachePath: `/fake/renders/${String(params.path)}@${editKey(
      (params.edit as Edit | undefined) ?? identityEdit,
    )}.jpg`,
  }),
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
  whiteBalance: (params) =>
    String(params.path).toLowerCase().endsWith(".arw")
      ? { temperature: 5250, tint: 8 }
      : { temperature: null, tint: null },
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
  status: () => ({ generation: 1, root: "/fake", shoots: shoots.length }),
};
