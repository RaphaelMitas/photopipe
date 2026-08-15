import type { ImageFile } from "./core";

export type SortKey = "name" | "date" | "score";

/// The core lists a shoot by name, so that order is the baseline every other
/// sort falls back to for ties and for files that have no score.
export function sortImages(images: ImageFile[], sort: SortKey): ImageFile[] {
  if (sort === "name") return images;
  const sorted = [...images];
  if (sort === "date") {
    sorted.sort((a, b) => a.mtime - b.mtime);
    return sorted;
  }
  sorted.sort((a, b) => {
    const left = a.score ?? null;
    const right = b.score ?? null;
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
  return sorted;
}
