import { describe, expect, it } from "vitest";
import { betterThan, instinctScore, scoreRanks } from "./instinct";
import { makeImage } from "./test-image";

describe("instinctScore", () => {
  it("maps the model's range onto 0 to 100", () => {
    expect(instinctScore(-1)).toBe(0);
    expect(instinctScore(0)).toBe(50);
    expect(instinctScore(1)).toBe(100);
    expect(instinctScore(0.739)).toBe(87);
  });

  it("clamps a score from outside the range instead of overflowing the meter", () => {
    expect(instinctScore(1.4)).toBe(100);
    expect(instinctScore(-2)).toBe(0);
  });
});

describe("scoreRanks", () => {
  it("ranks rated photos best first and skips the unrated", () => {
    const ranks = scoreRanks([
      makeImage("a.arw", { score: 0.1 }),
      makeImage("broken.arw", { score: null }),
      makeImage("b.arw", { score: 0.9 }),
    ]);
    expect(ranks.get("/r/s/b.arw")).toBe(1);
    expect(ranks.get("/r/s/a.arw")).toBe(2);
    expect(ranks.has("/r/s/broken.arw")).toBe(false);
    expect(ranks.size).toBe(2);
  });
});

describe("betterThan", () => {
  it("never claims a photo beats the whole project, including the best one", () => {
    expect(betterThan(1, 298)).toBe(99);
    expect(betterThan(14, 298)).toBe(95);
    expect(betterThan(298, 298)).toBe(0);
  });

  it("says nothing without a rank or without something to compare against", () => {
    expect(betterThan(null, 298)).toBeNull();
    expect(betterThan(1, 1)).toBeNull();
  });
});
