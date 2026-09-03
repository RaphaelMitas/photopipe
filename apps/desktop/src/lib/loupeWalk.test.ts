import { describe, expect, it } from "vitest";
import { heldOrder } from "./loupeWalk";
import { makeImage } from "./test-image";

const rels = (images: { rel: string }[]) => images.map((image) => image.rel);
const held = ["/r/s/a.arw", "/r/s/b.arw", "/r/s/c.arw"];

describe("heldOrder", () => {
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

  it("slots a photo it has never seen beside the one it arrived after", () => {
    const a = makeImage("a.arw");
    const live = [
      a,
      makeImage("b.arw"),
      makeImage("b2.arw"),
      makeImage("c.arw"),
    ];
    expect(rels(heldOrder(held, live, a))).toEqual([
      "a.arw",
      "b.arw",
      "b2.arw",
      "c.arw",
    ]);
  });

  it("keeps several newcomers in the order the browser gave them", () => {
    const a = makeImage("a.arw");
    const live = [
      makeImage("aa.arw"),
      makeImage("ab.arw"),
      a,
      makeImage("b.arw"),
      makeImage("c.arw"),
    ];
    expect(rels(heldOrder(held, live, a))).toEqual([
      "aa.arw",
      "ab.arw",
      "a.arw",
      "b.arw",
      "c.arw",
    ]);
  });

  it("takes an arrival and a departure in the same pass", () => {
    const a = makeImage("a.arw");
    const live = [a, makeImage("b2.arw"), makeImage("c.arw")];
    expect(rels(heldOrder(held, live, a))).toEqual([
      "a.arw",
      "b2.arw",
      "c.arw",
    ]);
  });

  it("gives back just the open photo when the browser has emptied", () => {
    const a = makeImage("a.arw");
    expect(rels(heldOrder(held, [], a))).toEqual(["a.arw"]);
  });
});
