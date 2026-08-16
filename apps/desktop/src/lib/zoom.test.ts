import { describe, expect, it } from "vitest";
import {
  centerOn,
  clampPan,
  regionScreenRect,
  stillServes,
  viewportRequest,
  visibleRect,
  zoomAt,
} from "./zoom";

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

describe("viewportRequest", () => {
  // The 750x500 box shows a 6000x4000 photo, so 100% is scale 8.
  const pixels = { width: 6000, height: 4000 };
  const request = (state: Parameters<typeof viewportRequest>[0]) =>
    viewportRequest(
      state,
      photo,
      view.width,
      view.height,
      pixels.width,
      pixels.height,
      2,
    );

  it("asks for nothing while the photo fits", () => {
    expect(request(null)).toBeNull();
    expect(request({ scale: 1, tx: 0, ty: 0 })).toBeNull();
  });

  it("asks only for the slice on screen", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 8, 8, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const got = request(centerOn(zoomed, { x: 0.5, y: 0.5 }, photo, 1000, 500));
    expect(got).not.toBeNull();
    if (!got) return;

    const width = got.viewport.right - got.viewport.left;
    expect(width).toBeLessThan(0.3);
    expect(got.viewport.left).toBeGreaterThan(0.3);
    expect(got.viewport.right).toBeLessThan(0.7);
    // Only what the region truly holds: 6000 * ~0.17 is far under a full frame.
    expect(got.maxPixel).toBeLessThan(pixels.width);
    expect(got.maxPixel).toBeGreaterThan(0);
  });

  it("never asks for more pixels than the region has", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 64, 64, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const deep = request(zoomed);
    expect(deep).not.toBeNull();
    if (!deep) return;
    const regionPixels =
      (deep.viewport.right - deep.viewport.left) * pixels.width;
    expect(deep.maxPixel).toBeLessThanOrEqual(Math.round(regionPixels) + 1);
  });

  it("renders past the viewport so a drag has somewhere to go", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 8, 8, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const centred = centerOn(zoomed, { x: 0.5, y: 0.5 }, photo, 1000, 500);
    const got = request(centred);
    expect(got).not.toBeNull();
    if (!got) return;

    const visible = visibleRect(centred, photo, view.width, view.height);
    expect(got.viewport.left).toBeLessThan(visible.x);
    expect(got.viewport.right).toBeGreaterThan(visible.x + visible.width);
  });

  it("keeps a slice through a drag inside its margin, drops it past", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 8, 8, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const centred = centerOn(zoomed, { x: 0.5, y: 0.5 }, photo, 1000, 500);
    const held = request(centred);

    const serves = (state: typeof centred) =>
      stillServes(held, request(state), state, photo, view.width, view.height);

    expect(serves(centred)).toBe(true);
    const nudged = clampPan(
      { ...centred, tx: centred.tx - 30 },
      photo,
      view.width,
      view.height,
    );
    expect(serves(nudged)).toBe(true);
    const far = clampPan(
      { ...centred, tx: centred.tx - 400 },
      photo,
      view.width,
      view.height,
    );
    expect(serves(far)).toBe(false);
  });

  it("drops a slice too coarse for a deeper zoom", () => {
    const shallow = zoomAt(null, { x: 500, y: 250 }, 2, 64, photo, 1000, 500);
    const deep = zoomAt(null, { x: 500, y: 250 }, 16, 64, photo, 1000, 500);
    expect(shallow).not.toBeNull();
    expect(deep).not.toBeNull();
    if (!shallow || !deep) return;

    // The shallow slice spans the deeper view, but far too coarsely for it.
    const wide = request(shallow);
    const close = request(deep);
    expect(wide?.viewport.left).toBeLessThan(close?.viewport.left ?? 0);
    expect(wide?.density ?? 1).toBeLessThan(close?.density ?? 0);
    expect(stillServes(wide, close, deep, photo, 1000, 500)).toBe(false);
  });

  it("places a slice by the bounds it was rendered for", () => {
    const zoomed = zoomAt(null, { x: 500, y: 250 }, 4, 8, photo, 1000, 500);
    expect(zoomed).not.toBeNull();
    if (!zoomed) return;
    const got = request(zoomed);
    expect(got).not.toBeNull();
    if (!got) return;

    // The margin puts its edges outside the stage, so it covers it fully.
    const rect = regionScreenRect(got.viewport, photo, zoomed);
    expect(rect.left).toBeLessThanOrEqual(0.01);
    expect(rect.top).toBeLessThanOrEqual(0.01);
    expect(rect.left + rect.width).toBeGreaterThanOrEqual(view.width - 0.01);
    expect(rect.top + rect.height).toBeGreaterThanOrEqual(view.height - 0.01);
  });
});
