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
