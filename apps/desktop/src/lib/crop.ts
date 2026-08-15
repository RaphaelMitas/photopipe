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

/// The largest about-center scale (capped at 1) at which the crop's corners,
/// rotated back into photo space, stay inside the photo.
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
  let scale = 1;
  for (const point of points) {
    const dx = (point.x - centerX) * cos - (point.y - centerY) * sin;
    const dy = (point.x - centerX) * sin + (point.y - centerY) * cos;
    if (dx > 0) scale = Math.min(scale, (imageWidth - centerX) / dx);
    if (dx < 0) scale = Math.min(scale, centerX / -dx);
    if (dy > 0) scale = Math.min(scale, (imageHeight - centerY) / dy);
    if (dy < 0) scale = Math.min(scale, centerY / -dy);
  }
  return scale;
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

/// Shrink the crop about its center just enough that it stays inside the
/// photo rotated by `angleDeg`. Never grows the rect.
export function constrainCrop(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const scale = fitScale(crop, angleDeg, imageWidth, imageHeight);
  if (scale >= 1) return crop;
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
