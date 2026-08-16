import type { Box } from "./crop";

/// Loupe zoom. `scale` is relative to the fitted view (1 = fit) and
/// `tx`/`ty` translate the fitted layer, applied before the scale with a
/// top-left origin. Fit itself is represented as `null` state.
export type ZoomState = { scale: number; tx: number; ty: number };

/// Keep the photo covering the viewport: clamp the pan so no gap opens on a
/// side the photo could fill, and center it on axes it cannot fill.
export function clampPan(
  state: ZoomState,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): ZoomState {
  const clampAxis = (
    translate: number,
    origin: number,
    size: number,
    view: number,
  ) => {
    const scaled = size * state.scale;
    const scaledOrigin = origin * state.scale;
    if (scaled <= view) return (view - scaled) / 2 - scaledOrigin;
    return Math.min(
      -scaledOrigin,
      Math.max(view - scaled - scaledOrigin, translate),
    );
  };
  return {
    scale: state.scale,
    tx: clampAxis(state.tx, photo.x, photo.width, viewWidth),
    ty: clampAxis(state.ty, photo.y, photo.height, viewHeight),
  };
}

/// Scale by `factor` keeping the viewport point `cursor` fixed. Returns null
/// when the result lands back at fit.
export function zoomAt(
  state: ZoomState | null,
  cursor: { x: number; y: number },
  factor: number,
  maxScale: number,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): ZoomState | null {
  const current = state ?? { scale: 1, tx: 0, ty: 0 };
  const scale = Math.min(Math.max(current.scale * factor, 1), maxScale);
  if (scale <= 1.001) return null;
  const ratio = scale / current.scale;
  const next = {
    scale,
    tx: cursor.x - ratio * (cursor.x - current.tx),
    ty: cursor.y - ratio * (cursor.y - current.ty),
  };
  return clampPan(next, photo, viewWidth, viewHeight);
}

/// The visible part of the photo in photo-normalized coordinates (for the
/// navigator's viewport rect).
export function visibleRect(
  state: ZoomState,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): Box {
  const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
  const left = clamp01(
    (0 - (photo.x * state.scale + state.tx)) / (photo.width * state.scale),
  );
  const right = clamp01(
    (viewWidth - (photo.x * state.scale + state.tx)) /
      (photo.width * state.scale),
  );
  const top = clamp01(
    (0 - (photo.y * state.scale + state.ty)) / (photo.height * state.scale),
  );
  const bottom = clamp01(
    (viewHeight - (photo.y * state.scale + state.ty)) /
      (photo.height * state.scale),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type ViewportRequest = {
  viewport: { left: number; top: number; right: number; bottom: number };
  maxPixel: number;
  /// Output pixels per source pixel, 1 being 1:1. Slices of different sizes
  /// only compare on this, not on `maxPixel`.
  density: number;
};

/// Rendered past the edges of the viewport, so a drag has somewhere to go
/// before the slice runs out. Costs (1 + margin)² in decode time and buys
/// that much pan for free.
const MARGIN = 0.25;

/// What the core should render for the current zoom: the slice on screen plus
/// a margin, at the resolution the screen can show, instead of the whole
/// frame. Null when the photo fits, where the ordinary render covers it.
export function viewportRequest(
  state: ZoomState | null,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
  pixelWidth: number,
  pixelHeight: number,
  devicePixelRatio: number,
): ViewportRequest | null {
  if (!state || photo.width <= 0 || photo.height <= 0) return null;
  const visible = visibleRect(state, photo, viewWidth, viewHeight);
  if (visible.width <= 0 || visible.height <= 0) return null;
  if (visible.width >= 1 && visible.height >= 1) return null;

  const viewport = {
    left: Math.max(0, visible.x - (visible.width * MARGIN) / 2),
    top: Math.max(0, visible.y - (visible.height * MARGIN) / 2),
    right: Math.min(1, visible.x + visible.width * (1 + MARGIN / 2)),
    bottom: Math.min(1, visible.y + visible.height * (1 + MARGIN / 2)),
  };
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  // Never more than the slice holds: upscaling would cost a bigger decode for
  // pixels the sensor never recorded.
  const sourcePixels = Math.max(width * pixelWidth, height * pixelHeight);
  const maxPixel = Math.round(
    Math.min(
      sourcePixels,
      Math.max(width * photo.width, height * photo.height) *
        state.scale *
        devicePixelRatio,
    ),
  );
  if (maxPixel <= 0 || sourcePixels <= 0) return null;
  return { viewport, maxPixel, density: maxPixel / sourcePixels };
}

/// Whether a slice already rendered still serves the view: it has to cover
/// what is on screen, and not be coarser than what the screen can show. A
/// slice that fails either would clip or look soft, so it must not be drawn.
export function stillServes(
  held: ViewportRequest | null,
  wanted: ViewportRequest | null,
  state: ZoomState | null,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): boolean {
  if (!held || !wanted || !state) return false;
  const visible = visibleRect(state, photo, viewWidth, viewHeight);
  const slack = 1e-6;
  return (
    held.viewport.left <= visible.x + slack &&
    held.viewport.top <= visible.y + slack &&
    held.viewport.right >= visible.x + visible.width - slack &&
    held.viewport.bottom >= visible.y + visible.height - slack &&
    held.density >= wanted.density - slack
  );
}

/// Where a slice sits on the stage, from the bounds it was rendered for.
export function regionScreenRect(
  viewport: ViewportRequest["viewport"],
  photo: Box,
  state: ZoomState,
) {
  return {
    left: (photo.x + viewport.left * photo.width) * state.scale + state.tx,
    top: (photo.y + viewport.top * photo.height) * state.scale + state.ty,
    width: (viewport.right - viewport.left) * photo.width * state.scale,
    height: (viewport.bottom - viewport.top) * photo.height * state.scale,
  };
}

/// Pan so the photo-normalized point sits at the viewport center.
export function centerOn(
  state: ZoomState,
  point: { x: number; y: number },
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): ZoomState {
  return clampPan(
    {
      scale: state.scale,
      tx: viewWidth / 2 - state.scale * (photo.x + point.x * photo.width),
      ty: viewHeight / 2 - state.scale * (photo.y + point.y * photo.height),
    },
    photo,
    viewWidth,
    viewHeight,
  );
}
