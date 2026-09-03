import type { ImageFile } from "./core";

/// The browser re-sorts under a rating, so the loupe walks the order it
/// arrived with. Photos it has never seen are slotted in beside the neighbour
/// they arrived next to, so an import mid-visit stays where the sort put it.
export function heldOrder(
  held: string[],
  live: ImageFile[],
  current: ImageFile,
): ImageFile[] {
  const byPath = new Map(live.map((image) => [image.path, image]));
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
    const image = path === current.path ? current : byPath.get(path);
    if (image) order.push(image);
    order.push(...(newcomers.get(path) ?? []));
  }
  return order;
}
