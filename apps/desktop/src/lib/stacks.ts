import type { ImageFile } from "./core";
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

export function stackRatingLabel(stack: Stack): string | null {
  const rating = stackRating(stack);
  if (rating === 0) return null;
  const rated = stack.frames.filter((frame) => frame.rating === rating).length;
  if (rated === stack.frames.length) return `all ★${rating}`;
  if (rated === 1) return `★${rating} picked`;
  return `★${rating} on ${rated} of ${stack.frames.length}`;
}

export function coverOf(stack: Stack): ImageFile {
  const score = (frame: ImageFile) => frame.score ?? Number.NEGATIVE_INFINITY;
  return stack.frames.reduce((best, frame) =>
    frame.rating > best.rating ||
    (frame.rating === best.rating && score(frame) > score(best))
      ? frame
      : best,
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

const changes = (stack: Stack, ratingOf: (frame: ImageFile) => number) =>
  new Map(
    stack.frames
      .filter((frame) => frame.rating !== ratingOf(frame))
      .map((frame) => [frame.path, ratingOf(frame)]),
  );

export const rateStack = (stack: Stack, rating: number) =>
  changes(stack, () => rating);

export function pickInStack(stack: Stack, path: string) {
  const kept = stackRating(stack) > 0 ? stackRating(stack) : 5;
  const writes = changes(stack, (frame) => (frame.path === path ? kept : 0));
  return {
    writes,
    kept,
    cleared: [...writes.keys()].filter((written) => written !== path).length,
  };
}

export function stackedOrder(
  images: ImageFile[],
  matches: (image: { rating: number }) => boolean,
  sort: SortKey,
  current?: ImageFile,
): ImageFile[] {
  return groupStacks(sortImages(images, sort))
    .filter(
      (stack) =>
        matches({ rating: stackRating(stack) }) ||
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
