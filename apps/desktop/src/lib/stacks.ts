import type { Flag, ImageFile } from "./core";
import { flagPref } from "./pref";
import { type SortKey, sortImages } from "./sort";

export const stacksPref = flagPref("photopipe.stacks", "on", "off", false);

/// Near-identical photos the core grouped, frames in capture order. A photo
/// that stands alone is a stack of one.
export type Stack = { id: string; frames: ImageFile[] };

// ties by path, like the core, so a sort cannot reorder burst frames that share a timestamp
function byCapture(a: ImageFile, b: ImageFile): number {
  if (a.captured === b.captured)
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  if (a.captured === null) return 1;
  if (b.captured === null) return -1;
  return a.captured - b.captured;
}

export function groupStacks(images: ImageFile[]): Stack[] {
  const byId = new Map<string, Stack>();
  for (const image of images) {
    const id = image.stack ?? image.path;
    const stack = byId.get(id);
    if (stack) stack.frames.push(image);
    else byId.set(id, { id, frames: [image] });
  }
  for (const stack of byId.values()) stack.frames.sort(byCapture);
  return [...byId.values()];
}

export const stackRating = (stack: Stack) =>
  Math.max(...stack.frames.map((frame) => frame.rating));

export function stackFlag(stack: Stack): Flag {
  if (stack.frames.some((frame) => frame.flag === 1)) return 1;
  return stack.frames.every((frame) => frame.flag === -1) ? -1 : 0;
}

export function stackRatingLabel(stack: Stack): string | null {
  const rating = stackRating(stack);
  if (rating === 0) return null;
  const rated = stack.frames.filter((frame) => frame.rating === rating).length;
  if (rated === stack.frames.length) return `all ★${rating}`;
  return `★${rating} on ${rated} of ${stack.frames.length}`;
}

const undecided = (frame: ImageFile) => frame.flag === 0 && frame.rating === 0;

export function coverOf(stack: Stack): ImageFile {
  const score = (frame: ImageFile) => frame.score ?? Number.NEGATIVE_INFINITY;
  const better = (a: ImageFile, b: ImageFile) =>
    a.flag !== b.flag
      ? a.flag > b.flag
      : a.rating !== b.rating
        ? a.rating > b.rating
        : score(a) > score(b);
  return stack.frames.reduce((best, frame) =>
    better(frame, best) ? frame : best,
  );
}

export const inStack = (stack: Stack, path: string | null) =>
  stack.frames.some((frame) => frame.path === path);

export const stackOf = (stacks: Stack[], path: string) =>
  stacks.find((stack) => inStack(stack, path));

/// Opening a photo that is in a stack but is not what the stack shows means
/// you came for that photo, so the loupe starts inside the stack, anchored on it.
export const anchorFor = (stack: Stack | undefined, path: string | null) =>
  path !== null &&
  stack !== undefined &&
  stack.frames.length > 1 &&
  coverOf(stack).path !== path
    ? path
    : null;

const changesTo = <V>(
  photos: ImageFile[],
  of: (photo: ImageFile) => V,
  value: V,
) =>
  new Map(
    photos
      .filter((photo) => of(photo) !== value)
      .map((photo) => [photo.path, value]),
  );

export const ratedTo = (photos: ImageFile[], rating: number) =>
  changesTo(photos, (photo) => photo.rating, rating);

export const sharedFlag = (photos: ImageFile[]): Flag =>
  photos.every((photo) => photo.flag === photos[0]?.flag)
    ? (photos[0]?.flag ?? 0)
    : 0;

export const toggledFlags = (photos: ImageFile[], flag: Flag) =>
  changesTo<Flag>(
    photos,
    (photo) => photo.flag,
    sharedFlag(photos) === flag ? 0 : flag,
  );

export const sweepStack = (stack: Stack) =>
  changesTo<Flag>(
    stackFlag(stack) === 1 ? stack.frames.filter(undecided) : [],
    (photo) => photo.flag,
    -1,
  );

export function stackedOrder(
  images: ImageFile[],
  matches: (image: { rating: number; flag: Flag }) => boolean,
  sort: SortKey,
  current?: ImageFile,
): ImageFile[] {
  return groupStacks(sortImages(images, sort))
    .filter(
      (stack) =>
        matches({ rating: stackRating(stack), flag: stackFlag(stack) }) ||
        (current !== undefined && inStack(stack, current.path)),
    )
    .flatMap((stack) => stack.frames);
}

export function step(
  stacks: Stack[],
  path: string,
  inside: boolean,
  direction: 1 | -1,
): ImageFile | undefined {
  const stack = stackOf(stacks, path);
  if (!stack) return undefined;
  if (inside) {
    const index = stack.frames.findIndex((frame) => frame.path === path);
    return stack.frames[index + direction];
  }
  const next = stacks[stacks.indexOf(stack) + direction];
  return next && coverOf(next);
}
