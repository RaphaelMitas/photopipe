import type { ImageFile } from "./core";
import { type SortKey, sortImages } from "./sort";

/// Rating a photo re-sorts the browser under it, so the loupe walks the order
/// it arrived with. The grid behind stays live and catches up when you leave.
export function heldOrder(
  held: string[],
  live: ImageFile[],
  current: ImageFile,
): ImageFile[] {
  const byPath = new Map(live.map((image) => [image.path, image]));
  const kept: ImageFile[] = [];
  for (const path of held) {
    if (path === current.path) kept.push(current);
    else {
      const image = byPath.get(path);
      if (image) kept.push(image);
    }
  }
  const known = new Set(held);
  return [...kept, ...live.filter((image) => !known.has(image.path))];
}

/// Changing the sort or the filter is a request to re-order, so the held order
/// is dropped. A photo the new filter rejects still belongs to the sort.
export function freshOrder(
  all: ImageFile[],
  live: ImageFile[],
  current: ImageFile,
  matches: (image: ImageFile) => boolean,
  sort: SortKey,
): ImageFile[] {
  if (live.some((image) => image.path === current.path)) return live;
  return sortImages(
    all.filter((image) => image.path === current.path || matches(image)),
    sort,
  );
}
