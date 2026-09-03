import type { ImageFile } from "./core";

/// The browser re-sorts under a rating, so the loupe walks the order it
/// arrived with. `current` has to be one of `held`; the caller rebuilds when
/// it is not, because only the sort knows where an unknown photo belongs.
export function heldOrder(
  held: string[],
  live: ImageFile[],
  current: ImageFile,
): ImageFile[] {
  const byPath = new Map(live.map((image) => [image.path, image]));
  byPath.set(current.path, current); // the open photo outlives the filter
  const known = new Set(held);
  const newcomers = new Map<string | null, ImageFile[]>();
  let anchor: string | null = null;
  for (const image of live) {
    if (known.has(image.path)) {
      anchor = image.path;
      continue;
    }
    const beside = newcomers.get(anchor) ?? [];
    beside.push(image);
    newcomers.set(anchor, beside);
  }

  const order = [...(newcomers.get(null) ?? [])];
  for (const path of held) {
    const image = byPath.get(path);
    if (image) order.push(image);
    order.push(...(newcomers.get(path) ?? []));
  }
  return order;
}
