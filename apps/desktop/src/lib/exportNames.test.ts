import { describe, expect, it } from "vitest";
import { exportName, templateProblem } from "./exportNames";
import { makeImage } from "./test-image";

const captured = Date.UTC(2026, 9, 24, 23, 41, 5) / 1000;

describe("exportName", () => {
  it("fills every token from the photo, the shoot and its place", () => {
    const image = makeImage("Floor/DSC01204.ARW", { captured, rating: 4 });
    expect(
      exportName(
        "{date}_{time}_{seq}_{original}_{rating}_{shoot}",
        image,
        41,
        212,
        "tanzabend",
      ),
    ).toBe("2026-10-24_234105_042_DSC01204_4_tanzabend");
  });

  it("pads the number to the widest one in the export", () => {
    expect(exportName("{seq}", makeImage("a.jpg"), 6, 1200, "s")).toBe("0007");
  });

  it("cleans what a photo brings and never hands back an empty name", () => {
    const image = makeImage("DSC01204.ARW");
    expect(exportName("{shoot}_{seq}", image, 0, 1, "Show: 1/2")).toBe(
      "Show- 1-2_001",
    );
    expect(exportName("..{shoot}", image, 0, 1, "")).toBe("DSC01204");
    const long = exportName("{shoot}", image, 0, 1, "ü".repeat(300));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(200);
  });
});

describe("templateProblem", () => {
  it("refuses unknown tokens, separators and an empty template", () => {
    expect(templateProblem("{date}_{seq}")).toBeNull();
    expect(templateProblem("{Date}_{seq}")).toContain("{Date}");
    expect(templateProblem("{date}/{seq}")).not.toBeNull();
    expect(templateProblem("  ")).not.toBeNull();
  });
});
