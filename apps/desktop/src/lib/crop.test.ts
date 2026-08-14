import { describe, expect, it } from "vitest";
import { editKey, identityEdit, isIdentityEdit } from "./core";
import {
  centeredAspectCrop,
  constrainCrop,
  cropInsideImage,
  fitRect,
  fullCrop,
  isFullCrop,
} from "./crop";

describe("fitRect", () => {
  it("letterboxes like object-contain", () => {
    expect(fitRect(1000, 500, 3000, 2000)).toEqual({
      x: 125,
      y: 0,
      width: 750,
      height: 500,
    });
    expect(fitRect(1000, 500, 1000, 250)).toEqual({
      x: 0,
      y: 125,
      width: 1000,
      height: 250,
    });
  });

  it("collapses on degenerate input instead of dividing by zero", () => {
    expect(fitRect(0, 500, 3000, 2000).width).toBe(0);
    expect(fitRect(1000, 500, 0, 0).width).toBe(0);
  });
});

describe("cropInsideImage / constrainCrop", () => {
  it("accepts the full frame at zero angle and rejects it once rotated", () => {
    expect(cropInsideImage(fullCrop, 0, 3000, 2000)).toBe(true);
    expect(cropInsideImage(fullCrop, 3, 3000, 2000)).toBe(false);
  });

  it("shrinks just enough that the rotated frame covers the crop", () => {
    const constrained = constrainCrop(fullCrop, 3, 3000, 2000);
    expect(cropInsideImage(constrained, 3, 3000, 2000)).toBe(true);
    // Barely smaller, not collapsed: 3° should cost a few percent.
    expect(constrained.right - constrained.left).toBeGreaterThan(0.85);
    expect(constrained.right - constrained.left).toBeLessThan(1);
    // Scaling happens about the center.
    expect(constrained.left + constrained.right).toBeCloseTo(1);
    expect(constrained.top + constrained.bottom).toBeCloseTo(1);
  });

  it("leaves an already-fitting crop untouched", () => {
    const small = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 };
    expect(constrainCrop(small, 10, 3000, 2000)).toEqual(small);
  });
});

describe("centeredAspectCrop", () => {
  it("builds the largest centered crop for a pixel aspect", () => {
    const square = centeredAspectCrop(1, 0, 3000, 2000);
    expect(square.left).toBeCloseTo(1 / 6);
    expect(square.top).toBe(0);
    expect(square.right).toBeCloseTo(5 / 6);
    expect(square.bottom).toBe(1);
    const wide = centeredAspectCrop(16 / 9, 0, 3000, 2000);
    expect(wide.left).toBe(0);
    expect(wide.right).toBe(1);
    const height = (wide.bottom - wide.top) * 2000;
    expect(3000 / height).toBeCloseTo(16 / 9);
  });
});

describe("crop in the edit model", () => {
  it("a crop or an angle breaks identity and changes the query key", () => {
    expect(isFullCrop(fullCrop)).toBe(true);
    expect(isIdentityEdit(identityEdit)).toBe(true);
    const cropped = {
      ...identityEdit,
      crop: { left: 0.1, top: 0, right: 1, bottom: 1 },
    };
    expect(isIdentityEdit(cropped)).toBe(false);
    expect(editKey(cropped)).not.toBe(editKey(identityEdit));
    const straightened = { ...identityEdit, cropAngle: 1.5 };
    expect(isIdentityEdit(straightened)).toBe(false);
    expect(editKey(straightened)).not.toBe(editKey(identityEdit));
  });
});
