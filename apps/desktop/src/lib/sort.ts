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

export function sortImages(images: ImageFile[], sort: SortKey): ImageFile[] {
  switch (sort) {
    case "name":
      return images;
    case "date":
      return [...images].sort((a, b) => a.taken - b.taken);
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
