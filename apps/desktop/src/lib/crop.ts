import type { CropRect } from "./core";

export type Box = { x: number; y: number; width: number; height: number };

export const fullCrop: CropRect = Object.freeze({
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
});

export function isFullCrop(crop: CropRect): boolean {
  const epsilon = 1e-4;
  return (
    crop.left < epsilon &&
    crop.top < epsilon &&
    crop.right > 1 - epsilon &&
    crop.bottom > 1 - epsilon
  );
}

/// The letterboxed rect an object-contain image occupies in its container.
export function fitRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): Box {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(
    containerWidth / imageWidth,
    containerHeight / imageHeight,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

// Screen coords are y-down, so a positive (clockwise on screen) photo
// rotation maps a screen point back into photo space via the -angle rotation.
function corners(crop: CropRect, imageWidth: number, imageHeight: number) {
  const centerX = ((crop.left + crop.right) / 2) * imageWidth;
  const centerY = ((crop.top + crop.bottom) / 2) * imageHeight;
  const xs = [crop.left * imageWidth, crop.right * imageWidth];
  const ys = [crop.top * imageHeight, crop.bottom * imageHeight];
  return {
    centerX,
    centerY,
    points: xs.flatMap((x) => ys.map((y) => ({ x, y }))),
  };
}

/// The largest about-its-center scale (capped at 1) at which the crop's
/// corners, rotated back into photo space about the PHOTO center (the
/// straighten pivot), stay inside the photo. 0 when no scale can fit —
/// the rotated rect center itself lies outside the frame.
function fitScale(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const radians = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const { centerX, centerY, points } = corners(crop, imageWidth, imageHeight);
  const pivotX = imageWidth / 2;
  const pivotY = imageHeight / 2;
  const baseX = pivotX + (centerX - pivotX) * cos - (centerY - pivotY) * sin;
  const baseY = pivotY + (centerX - pivotX) * sin + (centerY - pivotY) * cos;
  if (baseX < 0 || baseX > imageWidth || baseY < 0 || baseY > imageHeight) {
    return 0;
  }
  let scale = 1;
  for (const point of points) {
    const dx = (point.x - centerX) * cos - (point.y - centerY) * sin;
    const dy = (point.x - centerX) * sin + (point.y - centerY) * cos;
    if (dx > 0) scale = Math.min(scale, (imageWidth - baseX) / dx);
    if (dx < 0) scale = Math.min(scale, baseX / -dx);
    if (dy > 0) scale = Math.min(scale, (imageHeight - baseY) / dy);
    if (dy < 0) scale = Math.min(scale, baseY / -dy);
  }
  return Math.max(scale, 0);
}

/// Whether the crop rect, with the photo rotated by `angleDeg` behind it,
/// stays inside the photo (no blank corners).
export function cropInsideImage(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): boolean {
  return fitScale(crop, angleDeg, imageWidth, imageHeight) >= 1 - 1e-6;
}

function scaleAbout(crop: CropRect, scale: number): CropRect {
  const halfWidth = ((crop.right - crop.left) / 2) * scale;
  const halfHeight = ((crop.bottom - crop.top) / 2) * scale;
  const cx = (crop.left + crop.right) / 2;
  const cy = (crop.top + crop.bottom) / 2;
  return {
    left: cx - halfWidth,
    top: cy - halfHeight,
    right: cx + halfWidth,
    bottom: cy + halfHeight,
  };
}

/// Shrink the crop about its center just enough that it stays inside the
/// photo rotated by `angleDeg` about the photo center. Never grows the rect.
/// When shrinking alone cannot help (the rect's rotated position left the
/// frame entirely), slide it toward the photo center first.
export function constrainCrop(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const scale = fitScale(crop, angleDeg, imageWidth, imageHeight);
  if (scale >= 1) return crop;
  if (scale > 0) return scaleAbout(crop, scale);

  const dx = 0.5 - (crop.left + crop.right) / 2;
  const dy = 0.5 - (crop.top + crop.bottom) / 2;
  const centered = shift(crop, dx, dy);
  const centeredScale = fitScale(centered, angleDeg, imageWidth, imageHeight);
  if (centeredScale < 1) {
    return scaleAbout(centered, centeredScale);
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (
      fitScale(
        shift(crop, dx * mid, dy * mid),
        angleDeg,
        imageWidth,
        imageHeight,
      ) >= 1
    ) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return shift(crop, dx * hi, dy * hi);
}

/// Display-space pixel size after a whole-photo turn.
export function rotatedSize(
  width: number,
  height: number,
  rotation: number,
): [number, number] {
  return rotation % 180 === 0 ? [width, height] : [height, width];
}

/// Where the crop rect lands after the photo turns 90° clockwise: a point
/// (x, y) of the old frame displays at (1 - y, x) in the new one.
export function turnCrop(crop: CropRect): CropRect {
  return {
    left: 1 - crop.bottom,
    top: crop.left,
    right: 1 - crop.top,
    bottom: crop.right,
  };
}

/// Swap the crop's pixel width and height about its center, nudged and
/// shrunk as needed to stay inside the (possibly angled) photo.
export function transposeCrop(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const widthPx = (crop.right - crop.left) * imageWidth;
  const heightPx = (crop.bottom - crop.top) * imageHeight;
  let halfWidth = heightPx / 2 / imageWidth;
  let halfHeight = widthPx / 2 / imageHeight;
  const shrink = Math.min(1, 0.5 / halfWidth, 0.5 / halfHeight);
  halfWidth *= shrink;
  halfHeight *= shrink;
  const clamp = (value: number, half: number) =>
    Math.min(Math.max(value, half), 1 - half);
  const cx = clamp((crop.left + crop.right) / 2, halfWidth);
  const cy = clamp((crop.top + crop.bottom) / 2, halfHeight);
  return constrainCrop(
    {
      left: cx - halfWidth,
      top: cy - halfHeight,
      right: cx + halfWidth,
      bottom: cy + halfHeight,
    },
    angleDeg,
    imageWidth,
    imageHeight,
  );
}

export const MIN_CROP_SIZE = 0.05;

const shift = (crop: CropRect, dx: number, dy: number): CropRect => ({
  left: crop.left + dx,
  top: crop.top + dy,
  right: crop.right + dx,
  bottom: crop.bottom + dy,
});

/// After a boundary search, land exactly on a frame edge when the result is
/// within search precision of it (and the rotated photo still covers it).
function snapToBox(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const epsilon = 1e-4;
  const snap = (value: number) => {
    if (Math.abs(value) < epsilon) return 0;
    if (Math.abs(value - 1) < epsilon) return 1;
    return value;
  };
  const snapped = {
    left: snap(crop.left),
    top: snap(crop.top),
    right: snap(crop.right),
    bottom: snap(crop.bottom),
  };
  return cropInsideImage(snapped, angleDeg, imageWidth, imageHeight)
    ? snapped
    : crop;
}

/// Translate the crop toward target = crop + (dx, dy). The only boundary is
/// the rotated photo itself — a straightened photo's corners overhang the
/// frame box, and the crop may follow them.
///
/// For a fixed rect size and angle, the feasible region of the rect center
/// is an axis-aligned box in the photo's rotated (base) space: each corner
/// constraint "base(center) + offset inside the frame" is a per-axis bound
/// there, and rotation is an isometry. So the exact answer is a clamp of
/// the target in base space — the rect glides along diagonal edges and gives
/// ground back on one axis when the pointer trades it for the other.
export function moveCrop(
  crop: CropRect,
  dx: number,
  dy: number,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const radians = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = ((crop.right - crop.left) / 2) * imageWidth;
  const halfHeight = ((crop.bottom - crop.top) / 2) * imageHeight;

  let minOffsetX = Number.POSITIVE_INFINITY;
  let maxOffsetX = Number.NEGATIVE_INFINITY;
  let minOffsetY = Number.POSITIVE_INFINITY;
  let maxOffsetY = Number.NEGATIVE_INFINITY;
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      const offsetX = signX * halfWidth * cos - signY * halfHeight * sin;
      const offsetY = signX * halfWidth * sin + signY * halfHeight * cos;
      minOffsetX = Math.min(minOffsetX, offsetX);
      maxOffsetX = Math.max(maxOffsetX, offsetX);
      minOffsetY = Math.min(minOffsetY, offsetY);
      maxOffsetY = Math.max(maxOffsetY, offsetY);
    }
  }
  const loX = -minOffsetX;
  const hiX = imageWidth - maxOffsetX;
  const loY = -minOffsetY;
  const hiY = imageHeight - maxOffsetY;
  if (loX > hiX || loY > hiY) {
    return constrainCrop(crop, angleDeg, imageWidth, imageHeight);
  }

  const pivotX = imageWidth / 2;
  const pivotY = imageHeight / 2;
  const targetX = ((crop.left + crop.right) / 2 + dx) * imageWidth;
  const targetY = ((crop.top + crop.bottom) / 2 + dy) * imageHeight;
  const relX = targetX - pivotX;
  const relY = targetY - pivotY;
  const baseX = Math.min(Math.max(pivotX + relX * cos - relY * sin, loX), hiX);
  const baseY = Math.min(Math.max(pivotY + relX * sin + relY * cos, loY), hiY);
  // Inverse rotation (transpose) back into frame space.
  const backX = baseX - pivotX;
  const backY = baseY - pivotY;
  const centerX = pivotX + backX * cos + backY * sin;
  const centerY = pivotY - backX * sin + backY * cos;
  return snapToBox(
    {
      left: (centerX - halfWidth) / imageWidth,
      top: (centerY - halfHeight) / imageHeight,
      right: (centerX + halfWidth) / imageWidth,
      bottom: (centerY + halfHeight) / imageHeight,
    },
    angleDeg,
    imageWidth,
    imageHeight,
  );
}

export type CropHandle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";

/// Drag a handle by (dx, dy), clamped to the frame and the minimum size.
/// `ratio` locks the pixel aspect (width leads, the edge opposite the dragged
/// corner anchors). When the full delta would leave the rotated photo, the
/// largest feasible fraction applies, so a fast drag still lands flush on
/// the border instead of freezing.
export function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const apply = (fraction: number): CropRect => {
    let { left, top, right, bottom } = start;
    const stepX = dx * fraction;
    const stepY = dy * fraction;
    // No frame-box clamp: a rotated photo's overhang past the frame is fair
    // game; the coverage search below is the only boundary.
    if (handle.includes("l"))
      left = Math.min(left + stepX, right - MIN_CROP_SIZE);
    if (handle.includes("r"))
      right = Math.max(right + stepX, left + MIN_CROP_SIZE);
    if (handle.includes("t"))
      top = Math.min(top + stepY, bottom - MIN_CROP_SIZE);
    if (handle.includes("b"))
      bottom = Math.max(bottom + stepY, top + MIN_CROP_SIZE);
    if (ratio !== null) {
      const height = ((right - left) * imageWidth) / ratio / imageHeight;
      if (handle.includes("t")) top = bottom - height;
      else bottom = top + height;
    }
    return { left, top, right, bottom };
  };
  const full = apply(1);
  if (cropInsideImage(full, angleDeg, imageWidth, imageHeight)) {
    return snapToBox(full, angleDeg, imageWidth, imageHeight);
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (cropInsideImage(apply(mid), angleDeg, imageWidth, imageHeight)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return snapToBox(apply(lo), angleDeg, imageWidth, imageHeight);
}

/// The pixel width/height ratio a dropdown selection locks the crop to, in
/// display space; null means unconstrained.
export function aspectRatioFor(
  aspect: string,
  flipped: boolean,
  imageWidth: number,
  imageHeight: number,
): number | null {
  if (aspect === "free") return null;
  let ratio: number;
  if (aspect === "original") ratio = imageWidth / imageHeight;
  else if (aspect === "transposed") ratio = imageHeight / imageWidth;
  else {
    const [a, b] = aspect.split(":").map(Number);
    ratio = a / b;
  }
  return flipped ? 1 / ratio : ratio;
}

/// The largest centered crop with the given pixel aspect (width/height),
/// shrunk further if the current angle requires it.
export function centeredAspectCrop(
  aspect: number,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  let width = imageWidth;
  let height = width / aspect;
  if (height > imageHeight) {
    height = imageHeight;
    width = height * aspect;
  }
  const crop = {
    left: (1 - width / imageWidth) / 2,
    top: (1 - height / imageHeight) / 2,
    right: (1 + width / imageWidth) / 2,
    bottom: (1 + height / imageHeight) / 2,
  };
  return constrainCrop(crop, angleDeg, imageWidth, imageHeight);
}
