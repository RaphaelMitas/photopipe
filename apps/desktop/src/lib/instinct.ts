import type { ImageFile } from "./core";
import { sortImages } from "./sort";

/// Vision scores a photo from -1 to 1. Instinct shows that as 0 to 100, the
/// same way in every project, so a 78 in June means what a 78 means in August.
export function instinctScore(score: number): number {
  return Math.round(((Math.min(1, Math.max(-1, score)) + 1) / 2) * 100);
}

/// Position of each rated photo in the project, best first. Photos without a
/// score are left out, so a rank never counts a photo it cannot place.
export function scoreRanks(images: ImageFile[]): Map<string, number> {
  return new Map(
    sortImages(
      images.filter((image) => image.score != null),
      "score",
    ).map((image, index) => [image.path, index + 1]),
  );
}

/// Share of the project's rated photos this one scores above. Rounded down, so
/// the best photo reads 99 rather than claiming to beat itself.
export function betterThan(rank: number | null, total: number): number | null {
  if (rank === null || total < 2) return null;
  return Math.floor(((total - rank) / total) * 100);
}
