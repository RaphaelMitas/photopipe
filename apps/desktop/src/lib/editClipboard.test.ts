import { describe, expect, it } from "vitest";
import { type Edit, identityEdit } from "./core";
import { type EditClipboard, pasteEdit } from "./editClipboard";

const source: Edit = {
  ...identityEdit,
  exposure: 0.75,
  highlights: -30,
  shadows: 20,
  temperature: 5200,
  tint: 8,
  denoise: 60,
  vibrance: 15,
  saturation: -5,
  curveRGB: [
    { x: 0, y: 0.05 },
    { x: 1, y: 1 },
  ],
  crop: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
  cropAngle: 3,
  rotation: 90,
};

const clipboard: EditClipboard = {
  path: "/r/s/A.ARW",
  edit: source,
  raw: true,
};

describe("pasteEdit", () => {
  it("takes tone, colour and curves from the copied photo", () => {
    const pasted = pasteEdit(identityEdit, clipboard, true);

    expect(pasted).toMatchObject({
      exposure: 0.75,
      highlights: -30,
      shadows: 20,
      temperature: 5200,
      tint: 8,
      denoise: 60,
      vibrance: 15,
      saturation: -5,
      curveRGB: source.curveRGB,
    });
  });

  it("leaves the target's own framing alone", () => {
    const target: Edit = {
      ...identityEdit,
      crop: { left: 0, top: 0.2, right: 1, bottom: 0.8 },
      cropAngle: -1.5,
      rotation: 270,
    };

    const pasted = pasteEdit(target, clipboard, true);

    expect(pasted.crop).toEqual(target.crop);
    expect(pasted.cropAngle).toBe(-1.5);
    expect(pasted.rotation).toBe(270);
  });

  it("clears a crop the source has and the target does not", () => {
    const pasted = pasteEdit(identityEdit, clipboard, true);

    expect(pasted.crop).toBeNull();
    expect(pasted.cropAngle).toBe(0);
    expect(pasted.rotation).toBe(0);
  });

  it("resets fields the copied photo does not use", () => {
    const target: Edit = { ...identityEdit, exposure: 2, saturation: 40 };

    const pasted = pasteEdit(
      target,
      { ...clipboard, edit: identityEdit },
      true,
    );

    expect(pasted.exposure).toBe(0);
    expect(pasted.saturation).toBe(0);
  });

  it("keeps the target's white balance when raw and non-raw meet", () => {
    const target: Edit = { ...identityEdit, temperature: -20, tint: 5 };

    const pasted = pasteEdit(target, clipboard, false);

    expect(pasted.temperature).toBe(-20);
    expect(pasted.tint).toBe(5);
    expect(pasted.exposure).toBe(0.75);
    expect(pasted.vibrance).toBe(15);
  });

  it("does not paste raw denoise onto a JPEG", () => {
    const pasted = pasteEdit(identityEdit, clipboard, false);

    expect(pasted.denoise).toBeNull();
  });

  it("carries denoise between two raws", () => {
    const pasted = pasteEdit({ ...identityEdit, denoise: 10 }, clipboard, true);

    expect(pasted.denoise).toBe(60);
  });

  it("carries white balance between two non-raw photos", () => {
    const jpegSource: EditClipboard = {
      path: "/r/s/A.jpg",
      edit: { ...identityEdit, temperature: 40, tint: -10 },
      raw: false,
    };

    const pasted = pasteEdit(identityEdit, jpegSource, false);

    expect(pasted.temperature).toBe(40);
    expect(pasted.tint).toBe(-10);
  });
});
