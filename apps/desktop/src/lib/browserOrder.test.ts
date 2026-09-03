import { describe, expect, it } from "vitest";
import { browserOrder } from "./sort";
import { makeImage } from "./test-image";

const rels = (images: { rel: string }[]) => images.map((image) => image.rel);
const atLeastThree = (image: { rating: number }) => image.rating >= 3;

describe("browserOrder", () => {
  const images = [
    makeImage("a.arw", { rating: 1 }),
    makeImage("b.arw", { rating: 5 }),
    makeImage("c.arw", { rating: 4 }),
  ];

  it("filters, then sorts", () => {
    expect(rels(browserOrder(images, atLeastThree, "rating"))).toEqual([
      "b.arw",
      "c.arw",
    ]);
  });

  it("places a photo the filter rejects by the sort, not at the end", () => {
    expect(rels(browserOrder(images, atLeastThree, "name", images[0]))).toEqual(
      ["a.arw", "b.arw", "c.arw"],
    );
  });

  // A kept photo that outranks every match has to sort to the front, which is
  // what tells a real sort apart from tacking it on the end.
  it("sorts the photo it keeps by its own stars", () => {
    const atMostTwo = (image: { rating: number }) => image.rating <= 2;
    const kept = images[1];
    expect(rels(browserOrder(images, atMostTwo, "rating", kept))).toEqual([
      "b.arw",
      "a.arw",
    ]);
  });
});
