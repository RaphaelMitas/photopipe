import { describe, expect, it } from "vitest";
import fixture from "../../../../fixtures/curve-samples.json";
import { evaluateCurve, isIdentityCurve, sampleCurve } from "./curve";

describe("curve spline", () => {
  it("matches the Swift core sample for sample, via the shared fixture", () => {
    for (const testCase of fixture.cases) {
      const samples = sampleCurve(testCase.points, fixture.resolution);
      testCase.samples.forEach((expected, i) => {
        expect
          .soft(
            Math.abs(samples[i] - expected),
            `${testCase.name}[${i}]: ${samples[i]} vs fixture ${expected}`,
          )
          .toBeLessThan(1e-8);
      });
    }
  });

  it("passes through its points and stays monotone for monotone input", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.2 },
      { x: 0.7, y: 0.8 },
      { x: 1, y: 1 },
    ];
    for (const point of points) {
      expect(evaluateCurve(points, point.x)).toBeCloseTo(point.y, 9);
    }
    const samples = sampleCurve(points, 256);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("detects identity curves", () => {
    expect(isIdentityCurve([])).toBe(true);
    expect(
      isIdentityCurve([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(true);
    expect(
      isIdentityCurve([
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });
});
