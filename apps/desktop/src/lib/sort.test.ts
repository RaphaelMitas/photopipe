import { describe, expect, it } from "vitest";
import { sortImages } from "./sort";
import { makeImage } from "./test-image";

const rels = (images: { rel: string }[]) => images.map((image) => image.rel);

describe("sortImages", () => {
  it("keeps the core's order for name", () => {
    const images = [makeImage("b.arw"), makeImage("a.arw")];
    expect(sortImages(images, "name")).toBe(images);
  });

  it("puts the most stars first and unrated last", () => {
    const images = [
      makeImage("two.arw", { rating: 2 }),
      makeImage("none.arw", { rating: 0 }),
      makeImage("five.arw", { rating: 5 }),
    ];
    expect(rels(sortImages(images, "rating"))).toEqual([
      "five.arw",
      "two.arw",
      "none.arw",
    ]);
  });

  it("leaves photos with the same stars in the order they came in", () => {
    const images = [
      makeImage("b.arw", { rating: 3 }),
      makeImage("a.arw", { rating: 3 }),
      makeImage("c.arw", { rating: 4 }),
    ];
    expect(rels(sortImages(images, "rating"))).toEqual([
      "c.arw",
      "b.arw",
      "a.arw",
    ]);
  });

  it("puts the best score first", () => {
    const images = [
      makeImage("mid.arw", { score: 0.2 }),
      makeImage("best.arw", { score: 0.9 }),
      makeImage("worst.arw", { score: -0.5 }),
    ];
    expect(rels(sortImages(images, "score"))).toEqual([
      "best.arw",
      "mid.arw",
      "worst.arw",
    ]);
  });

  it("leaves ties and unscored photos in the order they came in", () => {
    const images = [
      makeImage("tie-a.arw", { score: 0.5 }),
      makeImage("none-a.arw", { score: null }),
      makeImage("tie-b.arw", { score: 0.5 }),
      makeImage("none-b.arw", { score: null }),
      makeImage("top.arw", { score: 0.7 }),
    ];
    expect(rels(sortImages(images, "score"))).toEqual([
      "top.arw",
      "tie-a.arw",
      "tie-b.arw",
      "none-a.arw",
      "none-b.arw",
    ]);
  });

  it("does not mutate the list it was given", () => {
    const images = [
      makeImage("a.arw", { score: 0.1 }),
      makeImage("b.arw", { score: 0.9 }),
    ];
    sortImages(images, "score");
    expect(rels(images)).toEqual(["a.arw", "b.arw"]);
  });
});
