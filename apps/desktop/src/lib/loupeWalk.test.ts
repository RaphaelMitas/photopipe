import { describe, expect, it } from "vitest";
import { freshOrder, heldOrder } from "./loupeWalk";
import { makeImage } from "./test-image";

const rels = (images: { rel: string }[]) => images.map((image) => image.rel);

describe("heldOrder", () => {
  const held = ["/r/s/a.arw", "/r/s/b.arw", "/r/s/c.arw"];

  it("keeps its order when the browser re-sorts underneath", () => {
    const b = makeImage("b.arw", { rating: 5 });
    const live = [b, makeImage("a.arw"), makeImage("c.arw")];
    expect(rels(heldOrder(held, live, b))).toEqual(["a.arw", "b.arw", "c.arw"]);
  });

  it("holds a photo the filter has dropped in the place it had", () => {
    const b = makeImage("b.arw", { rating: 0 });
    const live = [makeImage("a.arw"), makeImage("c.arw")];
    expect(rels(heldOrder(held, live, b))).toEqual(["a.arw", "b.arw", "c.arw"]);
  });

  it("drops a photo that has left the shoot", () => {
    const a = makeImage("a.arw");
    const live = [a, makeImage("c.arw")];
    expect(rels(heldOrder(held, live, a))).toEqual(["a.arw", "c.arw"]);
  });

  it("puts photos it has never seen at the end, so they stay reachable", () => {
    const a = makeImage("a.arw");
    const live = [makeImage("new.arw"), a, makeImage("b.arw")];
    expect(rels(heldOrder(held, live, a))).toEqual([
      "a.arw",
      "b.arw",
      "new.arw",
    ]);
  });
});

describe("freshOrder", () => {
  const rated = (rel: string, rating: number) => makeImage(rel, { rating });
  const atLeastThree = (image: { rating: number }) => image.rating >= 3;

  it("hands back the browser's list when the photo still matches", () => {
    const live = [rated("a.arw", 5), rated("b.arw", 3)];
    expect(freshOrder(live, live, live[1], atLeastThree, "rating")).toBe(live);
  });

  it("sorts a photo the new filter rejects back among the matches", () => {
    const all = [rated("a.arw", 5), rated("b.arw", 0), rated("c.arw", 4)];
    const live = [all[0], all[2]];
    expect(rels(freshOrder(all, live, all[1], atLeastThree, "name"))).toEqual([
      "a.arw",
      "b.arw",
      "c.arw",
    ]);
  });
});
