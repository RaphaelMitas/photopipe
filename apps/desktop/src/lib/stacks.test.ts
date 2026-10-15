import { describe, expect, it } from "vitest";
import {
  coverOf,
  groupStacks,
  opensInside,
  pickInStack,
  rateStack,
  stackedOrder,
  stepPath,
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
});

describe("rateStack", () => {
  it("writes only the frames that change", () => {
    const [stack] = groupStacks([
      frame("a1.arw", { rating: 1 }),
      frame("a2.arw", { rating: 0 }),
    ]);
    expect(rateStack(stack, 1)).toEqual(new Map([["/r/s/a2.arw", 1]]));
  });
});

describe("pickInStack", () => {
  it("keeps the stack's rating on the pick and clears the rest", () => {
    const [stack] = groupStacks([
      frame("a1.arw", { rating: 4 }),
      frame("a2.arw", { rating: 4 }),
      frame("a3.arw", { rating: 2 }),
    ]);
    expect(pickInStack(stack, "/r/s/a2.arw")).toEqual({
      writes: new Map([
        ["/r/s/a1.arw", 0],
        ["/r/s/a3.arw", 0],
      ]),
      kept: 4,
      cleared: 2,
    });
  });

  it("gives the pick five stars when nothing in the stack is rated", () => {
    const [stack] = groupStacks([frame("a1.arw"), frame("a2.arw")]);
    expect(pickInStack(stack, "/r/s/a1.arw")).toEqual({
      writes: new Map([["/r/s/a1.arw", 5]]),
      kept: 5,
      cleared: 0,
    });
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
    expect(rels(stackedOrder(images, atLeastFour))).toEqual([
      "a1.arw",
      "a2.arw",
    ]);
  });

  it("holds on to the stack you are in after it is rated out of the filter", () => {
    const images = [frame("a1.arw"), frame("a2.arw")];
    expect(rels(stackedOrder(images, atLeastFour, images[1]))).toEqual([
      "a1.arw",
      "a2.arw",
    ]);
  });
});

describe("stepPath", () => {
  const stacks = groupStacks([
    makeImage("solo.arw"),
    frame("a1.arw", { score: 0.1 }),
    frame("a2.arw", { score: 0.9 }),
    makeImage("last.arw"),
  ]);

  it("lands on the next stack's cover at stack level", () => {
    expect(stepPath(stacks, "/r/s/solo.arw", false, 1)).toBe("/r/s/a2.arw");
    expect(stepPath(stacks, "/r/s/a2.arw", false, 1)).toBe("/r/s/last.arw");
    expect(stepPath(stacks, "/r/s/last.arw", false, 1)).toBeNull();
  });

  it("stays inside the stack and stops at its ends", () => {
    expect(stepPath(stacks, "/r/s/a1.arw", true, 1)).toBe("/r/s/a2.arw");
    expect(stepPath(stacks, "/r/s/a2.arw", true, 1)).toBeNull();
    expect(stepPath(stacks, "/r/s/a1.arw", true, -1)).toBeNull();
  });
});

describe("opensInside", () => {
  it("only for a frame that is not the stack's cover", () => {
    const stacks = groupStacks([
      frame("a1.arw", { score: 0.1 }),
      frame("a2.arw", { score: 0.9 }),
      makeImage("solo.arw"),
    ]);
    expect(opensInside(stacks[0], "/r/s/a1.arw")).toBe(true);
    expect(opensInside(stacks[0], "/r/s/a2.arw")).toBe(false);
    expect(opensInside(stacks[1], "/r/s/solo.arw")).toBe(false);
  });
});
