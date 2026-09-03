import type { ImageFile } from "./core";

export type SortKey = "name" | "date" | "rating" | "score";

/// The core lists a shoot by name, so that order is the baseline every other
/// sort falls back to for ties and for files that have no score.
export function sortImages(images: ImageFile[], sort: SortKey): ImageFile[] {
  switch (sort) {
    case "name":
      return images;
    case "date":
      return [...images].sort((a, b) => a.mtime - b.mtime);
    case "rating":
      return [...images].sort((a, b) => b.rating - a.rating);
    case "score":
      return [...images].sort((a, b) => {
        const left = a.score ?? null;
        const right = b.score ?? null;
        if (left === right) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      });
  }
}

/// The browser's list: what the filter lets through, in the order the sort
/// asks for. `keep` is exempt from the filter but still placed by the sort,
/// which is how the loupe holds on to a photo you have just rated away.
export function browserOrder(
  images: ImageFile[],
  matches: (image: ImageFile) => boolean,
  sort: SortKey,
  keep?: ImageFile,
): ImageFile[] {
  return sortImages(
    images.filter((image) => image === keep || matches(image)),
    sort,
  );
}
