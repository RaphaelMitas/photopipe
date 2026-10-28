import { describe, expect, it } from "vitest";
import {
  anchorFor,
  coverOf,
  groupStacks,
  ratedTo,
  stackedOrder,
  stackFlag,
  step,
  sweepStack,
  toggledFlags,
} from "./stacks";
import { makeImage, rels } from "./test-image";

const STACK = "/r/s/a1.arw";
const frame = (rel: string, overrides = {}) =>
  makeImage(rel, { stack: STACK, ...overrides });

describe("groupStacks", () => {
  it("keeps a stack where its first photo appears and orders frames by capture", () => {
    const images = [
      makeImage("solo.arw"),
      frame("a2.arw", { captured: 2 }),
      makeImage("other.arw"),
      frame("a1.arw", { captured: 1 }),
    ];
    const stacks = groupStacks(images);
    expect(stacks.map((stack) => rels(stack.frames))).toEqual([
      ["solo.arw"],
      ["a1.arw", "a2.arw"],
      ["other.arw"],
    ]);
  });
});

describe("coverOf", () => {
  it("is the highest-rated frame, then Instinct's pick among those", () => {
    const [stack] = groupStacks([
      frame("a1.arw", { rating: 4, score: 0.1 }),
      frame("a2.arw", { rating: 4, score: 0.6 }),
      frame("a3.arw", { rating: 5, score: -0.9 }),
    ]);
    expect(coverOf(stack).rel).toBe("a3.arw");
    const [unrated] = groupStacks([
      frame("a1.arw", { score: 0.1 }),
      frame("a2.arw", { score: 0.6 }),
    ]);
    expect(coverOf(unrated).rel).toBe("a2.arw");
  });

  it("is the pick over any rating, and never a reject while a frame is not", () => {
    const [stack] = groupStacks([
      frame("a1.arw", { rating: 5, flag: -1 }),
      frame("a2.arw", { rating: 2, flag: 1 }),
      frame("a3.arw", { rating: 4 }),
    ]);
    expect(coverOf(stack).rel).toBe("a2.arw");
    const [rejected] = groupStacks([
      frame("a1.arw", { rating: 5, flag: -1 }),
      frame("a2.arw", { score: -0.9 }),
    ]);
    expect(coverOf(rejected).rel).toBe("a2.arw");
  });
});

describe("stackFlag", () => {
  it("is picked by any pick and rejected only when every frame is", () => {
    const flagged = (...flags: (-1 | 0 | 1)[]) =>
      stackFlag(
        groupStacks(flags.map((flag, i) => frame(`a${i}.arw`, { flag })))[0],
      );
    expect(flagged(-1, 1, 0)).toBe(1);
    expect(flagged(-1, 0)).toBe(0);
    expect(flagged(-1, -1)).toBe(-1);
  });
});

describe("ratedTo", () => {
  it("writes only the photos that change", () => {
    const photos = [
      frame("a1.arw", { rating: 1 }),
      frame("a2.arw", { rating: 0 }),
    ];
    expect(ratedTo(photos, 1)).toEqual(new Map([["/r/s/a2.arw", 1]]));
  });
});

describe("toggledFlags", () => {
  it("sets the flag on all, and takes it off only when all have it", () => {
    const mixed = [frame("a1.arw", { flag: -1 }), frame("a2.arw")];
    expect(toggledFlags(mixed, -1)).toEqual(new Map([["/r/s/a2.arw", -1]]));
    const both = [frame("a1.arw", { flag: -1 }), frame("a2.arw", { flag: -1 })];
    expect(toggledFlags(both, -1)).toEqual(
      new Map([
        ["/r/s/a1.arw", 0],
        ["/r/s/a2.arw", 0],
      ]),
    );
  });
});

describe("sweepStack", () => {
  it("rejects only the frames nobody judged, once the stack has a pick", () => {
    const frames = [
      frame("a1.arw", { flag: 1 }),
      frame("a2.arw"),
      frame("a3.arw", { rating: 3 }),
      frame("a4.arw", { flag: -1 }),
    ];
    expect(sweepStack(groupStacks(frames)[0])).toEqual(
      new Map([["/r/s/a2.arw", -1]]),
    );
    expect(sweepStack(groupStacks(frames.slice(1))[0]).size).toBe(0);
  });
});

describe("stackedOrder", () => {
  const atLeastFour = (image: { rating: number }) => image.rating >= 4;

  it("filters on the stack's rating and brings every frame along", () => {
    const images = [
      frame("a1.arw", { rating: 4 }),
      frame("a2.arw"),
      makeImage("solo.arw", { rating: 1 }),
    ];
    expect(rels(stackedOrder(images, atLeastFour, "name"))).toEqual([
      "a1.arw",
      "a2.arw",
    ]);
  });

  it("holds on to the stack you are in after it is rated out of the filter", () => {
    const images = [frame("a1.arw"), frame("a2.arw")];
    expect(rels(stackedOrder(images, atLeastFour, "name", images[1]))).toEqual([
      "a1.arw",
      "a2.arw",
    ]);
  });
});

describe("step", () => {
  const stacks = groupStacks([
    makeImage("solo.arw"),
    frame("a1.arw", { score: 0.1 }),
    frame("a2.arw", { score: 0.9 }),
    makeImage("last.arw"),
  ]);

  it("lands on the next stack's cover at stack level", () => {
    expect(step(stacks, "/r/s/solo.arw", false, 1)?.path).toBe("/r/s/a2.arw");
    expect(step(stacks, "/r/s/a2.arw", false, 1)?.path).toBe("/r/s/last.arw");
    expect(step(stacks, "/r/s/last.arw", false, 1)).toBeUndefined();
  });

  it("stays inside the stack and stops at its ends", () => {
    expect(step(stacks, "/r/s/a1.arw", true, 1)?.path).toBe("/r/s/a2.arw");
    expect(step(stacks, "/r/s/a2.arw", true, 1)).toBeUndefined();
    expect(step(stacks, "/r/s/a1.arw", true, -1)).toBeUndefined();
  });
});

describe("anchorFor", () => {
  it("only for a frame that is not the stack's cover", () => {
    const stacks = groupStacks([
      frame("a1.arw", { score: 0.1 }),
      frame("a2.arw", { score: 0.9 }),
      makeImage("solo.arw"),
    ]);
    expect(anchorFor(stacks[0], "/r/s/a1.arw")).toBe("/r/s/a1.arw");
    expect(anchorFor(stacks[0], "/r/s/a2.arw")).toBeNull();
    expect(anchorFor(stacks[1], "/r/s/solo.arw")).toBeNull();
  });
});
