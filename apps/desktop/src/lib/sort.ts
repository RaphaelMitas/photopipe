import type { ImageFile } from "./core";
import { pref } from "./pref";

export const SORT_KEYS = ["name", "date", "rating", "score"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  date: "Date",
  rating: "Rating",
  score: "Instinct",
};

export function isSortKey(value: unknown): value is SortKey {
  return SORT_KEYS.some((key) => key === value);
}

export const sortPref = pref(
  "photopipe.sort",
  (raw): SortKey => (isSortKey(raw) ? raw : "name"),
  String,
);

// captured reads the camera clock as UTC; local wall time is mtime's closest match
export const takenAt = (image: ImageFile) =>
  image.captured ??
  image.mtime - new Date(image.mtime * 1000).getTimezoneOffset() * 60;

/// The core lists a shoot by name, so that order is the baseline every other
/// sort falls back to for ties and for files that have no score.
export function sortImages(images: ImageFile[], sort: SortKey): ImageFile[] {
  switch (sort) {
    case "name":
      return images;
    case "date":
      return [...images].sort((a, b) => takenAt(a) - takenAt(b));
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

/// `keep`, which must be one of `images`, survives the filter so the loupe can
/// hold on to a photo you have just rated out of it.
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
