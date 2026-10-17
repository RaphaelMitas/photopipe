import { type ImageFile, identityEdit } from "./core";

/// `path` defaults to `/r/s/<rel>`; override anything.
export function makeImage(
  rel: string,
  overrides: Partial<ImageFile> = {},
): ImageFile {
  const ext = rel.split(".").pop() ?? "";
  return {
    path: `/r/s/${rel}`,
    rel,
    ext,
    size: 1,
    mtime: 1,
    rating: 0,
    edit: { ...identityEdit },
    width: 3000,
    height: 2000,
    score: null,
    captured: null,
    stack: null,
    enriched: true,
    isRaw: ["arw", "dng"].includes(ext.toLowerCase()),
    ...overrides,
  };
}

export const rels = (images: { rel: string }[]) =>
  images.map((image) => image.rel);
