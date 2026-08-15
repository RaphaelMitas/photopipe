import { describe, expect, it } from "vitest";
import { type ImageFile, normalizeImage } from "./core";
import { makeImage } from "./test-image";

describe("normalizeImage", () => {
  it("fills in the score the core leaves out for an unrated photo", () => {
    // What listImages actually sends: no `score` key at all.
    const { score, ...unrated } = makeImage("DSC00001.ARW");
    expect("score" in unrated).toBe(false);

    expect(normalizeImage(unrated as ImageFile).score).toBeNull();
  });

  it("leaves a real score alone", () => {
    expect(normalizeImage(makeImage("a.arw", { score: 0.4 })).score).toBe(0.4);
    expect(normalizeImage(makeImage("b.arw", { score: 0 })).score).toBe(0);
  });
});
