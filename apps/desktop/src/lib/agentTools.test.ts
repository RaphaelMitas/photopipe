import { describe, expect, it } from "vitest";
import { agentEdit } from "./agentTools";
import { identityEdit } from "./core";
import { makeImage } from "./test-image";

describe("agentEdit", () => {
  const raw = makeImage("a.ARW");
  const jpeg = makeImage("a.jpg");

  it("leaves a straighten past the slider's reach alone when the agent only crops", () => {
    const base = { ...identityEdit, cropAngle: 100 };
    const next = agentEdit(
      base,
      { crop: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 } },
      raw,
    );
    expect(next.cropAngle).toBe(100);
  });

  it("carries the crop round when the agent turns the photo", () => {
    const base = {
      ...identityEdit,
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
    };
    const next = agentEdit(base, { rotation: 90 }, raw);
    // the kept left half of the photo is the top half once it is turned
    expect(next.rotation).toBe(90);
    expect(next.crop).toEqual({ left: 0, top: 0, right: 1, bottom: 0.5 });
  });

  it("stores neutral white balance off a raw as none, like the editor", () => {
    const next = agentEdit(identityEdit, { temperature: 0, tint: 0 }, jpeg);
    expect(next.temperature).toBeNull();
    expect(next.tint).toBeNull();
    expect(
      agentEdit(identityEdit, { temperature: 5200 }, raw).temperature,
    ).toBe(5200);
  });
});
