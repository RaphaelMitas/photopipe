import type { ImageFile } from "./core";
import { sortImages } from "./sort";

export function instinctScore(score: number): number {
  return Math.round(((Math.min(1, Math.max(-1, score)) + 1) / 2) * 100);
}

export function scoreRanks(images: ImageFile[]): Map<string, number> {
  return new Map(
    sortImages(
      images.filter((image) => image.score != null),
      "score",
    ).map((image, index) => [image.path, index + 1]),
  );
}

export function betterThan(rank: number | null, total: number): number | null {
  if (rank === null || total < 2) return null;
  return Math.floor(((total - rank) / total) * 100);
}
