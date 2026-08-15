import { describe, expect, it } from "vitest";
import { centerOn, clampPan, visibleRect, zoomAt } from "./zoom";

// A 1000x500 viewport showing a 3:2 photo letterboxed to 750x500 at x=125.
const view = { width: 1000, height: 500 };
const photo = { x: 125, y: 0, width: 750, height: 500 };

describe("zoomAt", () => {
  it("keeps the cursor point fixed while scaling", () => {
    const cursor = { x: 400, y: 250 };
    const state = zoomAt(null, cursor, 2, 8, photo, view.width, view.height);
    expect(state).not.toBeNull();
    if (!state) return;
    // The photo point under the cursor before (cursor, scale 1) must still
    // be under the cursor after: s*p + t = cursor where p = cursor.
    expect(state.scale * cursor.x + state.tx).toBeCloseTo(cursor.x);
    expect(state.scale * cursor.y + state.ty).toBeCloseTo(cursor.y);
  });

  it("returns null at or below fit", () => {
    const zoomed = zoomAt(null, { x: 0, y: 0 }, 2, 8, photo, 1000, 500);
    expect(zoomAt(zoomed, { x: 0, y: 0 }, 0.4, 8, photo, 1000, 500)).toBeNull();
  });

  it("clamps to maxScale", () => {
    const state = zoomAt(null, { x: 500, y: 250 }, 100, 4, photo, 1000, 500);
    expect(state?.scale).toBe(4);
  });
});

describe("clampPan", () => {
  it("never opens a gap on a side the photo can fill", () => {
    const state = clampPan(
      { scale: 4, tx: 9999, ty: -9999 },
      photo,
      view.width,
      view.height,
    );
    // Left photo edge at or left of the viewport edge, right at or beyond.
    expect(4 * photo.x + state.tx).toBeLessThanOrEqual(0);
    expect(4 * (photo.x + photo.width) + state.tx).toBeGreaterThanOrEqual(
      view.width,
    );
    expect(4 * (photo.y + photo.height) + state.ty).toBeGreaterThanOrEqual(
      view.height,
    );
  });

  it("centers an axis the photo cannot fill", () => {
    // scale 1.2: width 900 < viewport 1000 stays centered.
    const state = clampPan({ scale: 1.2, tx: 500, ty: 0 }, photo, 1000, 500);
    expect(1.2 * photo.x + state.tx).toBeCloseTo((1000 - 900) / 2);
  });
});

describe("visibleRect and centerOn", () => {
  it("centering a point puts it mid-viewport", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 4, 8, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const centered = centerOn(zoomed, { x: 0.25, y: 0.5 }, photo, 1000, 500);
    const visible = visibleRect(centered, photo, 1000, 500);
    expect(visible.x + visible.width / 2).toBeCloseTo(0.25);
    expect(visible.y + visible.height / 2).toBeCloseTo(0.5);
  });
});
