import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "Europe/Berlin";
});

const { exposureParts, shutterText, takenTime } = await import("./exif");

describe("exif", () => {
  it("writes shutter speeds the way the camera shows them", () => {
    expect(shutterText(1 / 8000)).toBe("1/8000");
    expect(shutterText(0.000199999994946943)).toBe("1/5000");
    expect(shutterText(1 / 40)).toBe("1/40");
    expect(shutterText(1 / 3)).toBe("1/3");
    expect(shutterText(0.3)).toBe("0.3 s");
    expect(shutterText(0.5)).toBe("0.5 s");
    expect(shutterText(2)).toBe("2 s");
  });

  it("skips what the file does not carry", () => {
    expect(exposureParts({ shutter: 1 / 40, iso: 6400 })).toEqual([
      "1/40",
      "ISO 6400",
    ]);
    expect(
      exposureParts({ shutter: 1 / 40, aperture: 2.8, iso: 6400, focal: 35 }),
    ).toEqual(["1/40", "f/2.8", "ISO 6400", "35mm"]);
    expect(exposureParts({ aperture: 0.95 })).toEqual(["f/0.95"]);
  });

  it("shows the camera's clock, not the clock shifted into the local zone", () => {
    // 2026-10-26 22:41:07 on the camera, which would read 23:41 in Darmstadt
    expect(takenTime(1_793_054_467)).toMatch(/^(22:41:07|10:41:07\sPM)$/);
  });
});
