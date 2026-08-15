import { describe, expect, it } from "vitest";
import { commitDraft, draftFromEdit } from "@/components/CropTool";
import { editKey, identityEdit, isIdentityEdit } from "./core";
import {
  aspectRatioFor,
  centeredAspectCrop,
  constrainCrop,
  cropInsideImage,
  fitRect,
  fullCrop,
  isFullCrop,
  rotatedSize,
  transposeCrop,
  turnCrop,
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

describe("turn, transpose, and ratio helpers", () => {
  it("rotatedSize swaps dimensions on quarter turns", () => {
    expect(rotatedSize(3000, 2000, 0)).toEqual([3000, 2000]);
    expect(rotatedSize(3000, 2000, 90)).toEqual([2000, 3000]);
    expect(rotatedSize(3000, 2000, 180)).toEqual([3000, 2000]);
    expect(rotatedSize(3000, 2000, 270)).toEqual([2000, 3000]);
  });

  it("turnCrop follows the photo through a clockwise turn", () => {
    // The left half of the frame becomes the top half.
    expect(turnCrop({ left: 0, top: 0, right: 0.5, bottom: 1 })).toEqual({
      left: 0,
      top: 0,
      right: 1,
      bottom: 0.5,
    });
    // Four turns land back where they started.
    const rect = { left: 0.1, top: 0.2, right: 0.7, bottom: 0.9 };
    const four = turnCrop(turnCrop(turnCrop(turnCrop(rect))));
    expect(four.left).toBeCloseTo(rect.left);
    expect(four.top).toBeCloseTo(rect.top);
    expect(four.right).toBeCloseTo(rect.right);
    expect(four.bottom).toBeCloseTo(rect.bottom);
  });

  it("transposeCrop swaps pixel dimensions about the center", () => {
    const centered = transposeCrop(
      { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
      0,
      3000,
      2000,
    );
    expect((centered.right - centered.left) * 3000).toBeCloseTo(1000);
    expect((centered.bottom - centered.top) * 2000).toBeCloseTo(1500);
    expect(centered.left + centered.right).toBeCloseTo(1);

    // Near an edge the transposed rect gets nudged back inside.
    const nudged = transposeCrop(
      { left: 0, top: 0.4, right: 0.4, bottom: 0.6 },
      0,
      1000,
      1000,
    );
    expect(nudged.left).toBeGreaterThanOrEqual(0);
    expect(nudged.top).toBeGreaterThanOrEqual(0);
    expect(nudged.bottom).toBeLessThanOrEqual(1);
    expect(cropInsideImage(nudged, 0, 1000, 1000)).toBe(true);
  });

  it("aspectRatioFor resolves original, transposed, presets, and flips", () => {
    expect(aspectRatioFor("free", false, 3000, 2000)).toBeNull();
    expect(aspectRatioFor("original", false, 3000, 2000)).toBeCloseTo(1.5);
    expect(aspectRatioFor("transposed", false, 3000, 2000)).toBeCloseTo(2 / 3);
    expect(aspectRatioFor("4:5", false, 3000, 2000)).toBeCloseTo(0.8);
    expect(aspectRatioFor("4:5", true, 3000, 2000)).toBeCloseTo(1.25);
  });

  it("a turn-only draft commits rotation without a crop rect", () => {
    const turned = { ...draftFromEdit(identityEdit), rotation: 90 };
    expect(commitDraft(turned)).toEqual({
      crop: null,
      cropAngle: 0,
      rotation: 90,
    });
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
