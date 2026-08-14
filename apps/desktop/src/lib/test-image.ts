import type { ImageFile } from "./core";

/// `path` defaults to `/r/s/<rel>`; override anything.
export function makeImage(
  rel: string,
  overrides: Partial<ImageFile> = {},
): ImageFile {
  return {
    path: `/r/s/${rel}`,
    rel,
    ext: rel.split(".").pop() ?? "",
    size: 1,
    mtime: 1,
    rating: 0,
    exposure: 0,
    width: 3000,
    height: 2000,
    ...overrides,
  };
}
