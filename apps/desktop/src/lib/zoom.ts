import type { Box } from "./crop";
import { clamp01 } from "./curve";

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

export function photoFractionAt(
  state: ZoomState | null,
  cursor: { x: number; y: number },
  photo: Box,
) {
  const { scale, tx, ty } = state ?? { scale: 1, tx: 0, ty: 0 };
  return {
    x: ((cursor.x - tx) / scale - photo.x) / photo.width,
    y: ((cursor.y - ty) / scale - photo.y) / photo.height,
  };
}

/// The visible part of the photo in photo-normalized coordinates (for the
/// navigator's viewport rect).
export function visibleRect(
  state: ZoomState,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
): Box {
  const from = photoFractionAt(state, { x: 0, y: 0 }, photo);
  const to = photoFractionAt(state, { x: viewWidth, y: viewHeight }, photo);
  const x = clamp01(from.x);
  const y = clamp01(from.y);
  return { x, y, width: clamp01(to.x) - x, height: clamp01(to.y) - y };
}

export type ViewportRequest = {
  viewport: { left: number; top: number; right: number; bottom: number };
  maxPixel: number;
};

/// What the core should render for the current zoom: the slice on screen at
/// the resolution the screen can show, instead of the whole frame. Null when
/// the photo fits, where the ordinary render already covers it.
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

  const onScreen = visibleScreenRect(state, photo, viewWidth, viewHeight);
  // Never more than the slice holds: upscaling would cost a bigger decode for
  // pixels the sensor never recorded.
  const maxPixel = Math.round(
    Math.min(
      Math.max(visible.width * pixelWidth, visible.height * pixelHeight),
      Math.max(onScreen.width, onScreen.height) * devicePixelRatio,
    ),
  );
  if (maxPixel <= 0) return null;
  return {
    viewport: {
      left: visible.x,
      top: visible.y,
      right: visible.x + visible.width,
      bottom: visible.y + visible.height,
    },
    maxPixel,
  };
}

/// Identity of a request, so the loupe can tell whether the slice it holds
/// still matches the view. Anything else is stale and must not be drawn.
export function viewportKey(request: ViewportRequest | null): string {
  if (!request) return "";
  const { left, top, right, bottom } = request.viewport;
  return `${left},${top},${right},${bottom}@${request.maxPixel}`;
}

/// The part of the stage the photo actually covers. A slice rendered for this
/// state lands here exactly.
export function visibleScreenRect(
  state: ZoomState,
  photo: Box,
  viewWidth: number,
  viewHeight: number,
) {
  const left = photo.x * state.scale + state.tx;
  const top = photo.y * state.scale + state.ty;
  const clampedLeft = Math.max(0, left);
  const clampedTop = Math.max(0, top);
  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.min(viewWidth, left + photo.width * state.scale) - clampedLeft,
    height: Math.min(viewHeight, top + photo.height * state.scale) - clampedTop,
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
