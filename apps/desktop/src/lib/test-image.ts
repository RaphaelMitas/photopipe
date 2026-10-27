import { type ImageFile, identityEdit } from "./core";

/// `path` defaults to `/r/s/<rel>`; override anything.
export function makeImage(
  rel: string,
  overrides: Partial<ImageFile> = {},
): ImageFile {
  return {
    path: `/r/s/${rel}`,
    rel,
    size: 1,
    mtime: 1,
    rating: 0,
    flag: 0,
    edit: { ...identityEdit },
    width: 3000,
    height: 2000,
    score: null,
    captured: null,
    exif: {},
    stack: null,
    enriched: true,
    isRaw: /\.(arw|dng)$/i.test(rel),
    ...overrides,
  };
}

export const rels = (images: { rel: string }[]) =>
  images.map((image) => image.rel);
