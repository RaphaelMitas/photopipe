import type { ImageFile } from "./core";
import { flagPref } from "./pref";

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

/// Stacks in the order their first photo appears in `images`.
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

/// The frame a stack shows from outside: the highest-rated one, then
/// Instinct's pick among those, then the first taken.
export function coverOf(stack: Stack): ImageFile {
  const score = (frame: ImageFile) => frame.score ?? Number.NEGATIVE_INFINITY;
  return stack.frames.reduce((best, frame) =>
    frame.rating > best.rating ||
    (frame.rating === best.rating && score(frame) > score(best))
      ? frame
      : best,
  );
}

export const stackOf = (stacks: Stack[], path: string) =>
  stacks.find((stack) => stack.frames.some((frame) => frame.path === path));

/// Opening a photo that is in a stack but is not what the stack shows means
/// you came for that photo, so the loupe starts inside the stack.
export const opensInside = (stack: Stack | undefined, path: string) =>
  stack !== undefined &&
  stack.frames.length > 1 &&
  coverOf(stack).path !== path;

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
  return {
    writes: changes(stack, (frame) => (frame.path === path ? kept : 0)),
    kept,
    cleared: stack.frames.filter(
      (frame) => frame.path !== path && frame.rating !== 0,
    ).length,
  };
}

export function stackedOrder(
  sorted: ImageFile[],
  matches: (image: { rating: number }) => boolean,
  current?: ImageFile,
): ImageFile[] {
  return groupStacks(sorted)
    .filter(
      (stack) =>
        matches({ rating: stackRating(stack) }) ||
        (current !== undefined &&
          stack.frames.some((frame) => frame.path === current.path)),
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
