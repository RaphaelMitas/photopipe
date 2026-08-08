// Fake core dataset for Playwright runs (VITE_E2E=1). Only imported there.
import type { ImageGroup, Shoot } from "./lib/core";

const zellImages: ImageGroup[] = [
  {
    stem: "DSC00832",
    stage: "export",
    rating: 0,
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
  },
  {
    name: "misc",
    path: "/fake/misc",
    day: null,
    project: null,
    counts: { raw: 1, denoised: 0, export: 0 },
    imageCount: 1,
  },
];

const miscImages: ImageGroup[] = [
  {
    stem: "IMG_0001",
    stage: "raw",
    rating: 0,
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
    images: params.shoot === "2026-07-12_zell" ? zellImages : miscImages,
  }),
  thumbnail: (params) => ({
    cachePath: `/fake/thumbs/${String(params.path)}.jpg`,
  }),
  render: (params) => ({
    cachePath: `/fake/renders/${String(params.path)}@${String(params.exposure)}.jpg`,
  }),
  setRating: (params) => {
    const all = [...zellImages, ...miscImages];
    const target = all.find((image) => image.stem === params.stem);
    if (!target) throw `unknown_image: ${String(params.stem)}`;
    target.rating = Number(params.rating);
    return { rating: target.rating, generation: 1 };
  },
  status: () => ({ generation: 1, root: "/fake", shoots: shoots.length }),
};
