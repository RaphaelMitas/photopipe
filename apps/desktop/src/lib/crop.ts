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

function rotationTerms(angleDeg: number) {
  const radians = (-angleDeg * Math.PI) / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

const center = (crop: CropRect) => ({
  x: (crop.left + crop.right) / 2,
  y: (crop.top + crop.bottom) / 2,
});

const boxAround = (
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): CropRect => ({
  left: cx - halfWidth,
  top: cy - halfHeight,
  right: cx + halfWidth,
  bottom: cy + halfHeight,
});

const shift = (crop: CropRect, dx: number, dy: number): CropRect => ({
  left: crop.left + dx,
  top: crop.top + dy,
  right: crop.right + dx,
  bottom: crop.bottom + dy,
});

function largestFeasible(feasible: (t: number) => boolean): number {
  if (feasible(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (feasible(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function corners(crop: CropRect, imageWidth: number, imageHeight: number) {
  const centerX = center(crop).x * imageWidth;
  const centerY = center(crop).y * imageHeight;
  const xs = [crop.left * imageWidth, crop.right * imageWidth];
  const ys = [crop.top * imageHeight, crop.bottom * imageHeight];
  return {
    centerX,
    centerY,
    points: xs.flatMap((x) => ys.map((y) => ({ x, y }))),
  };
}

function fitScale(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const { cos, sin } = rotationTerms(angleDeg);
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

export function cropInsideImage(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): boolean {
  return fitScale(crop, angleDeg, imageWidth, imageHeight) >= 1 - 1e-6;
}

function scaleAbout(crop: CropRect, scale: number): CropRect {
  const c = center(crop);
  return boxAround(
    c.x,
    c.y,
    ((crop.right - crop.left) / 2) * scale,
    ((crop.bottom - crop.top) / 2) * scale,
  );
}

export function constrainCrop(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const scale = fitScale(crop, angleDeg, imageWidth, imageHeight);
  if (scale >= 1) return crop;
  if (scale > 0) return scaleAbout(crop, scale);

  const dx = 0.5 - center(crop).x;
  const dy = 0.5 - center(crop).y;
  const centered = shift(crop, dx, dy);
  const centeredScale = fitScale(centered, angleDeg, imageWidth, imageHeight);
  if (centeredScale < 1) {
    return scaleAbout(centered, centeredScale);
  }
  const slack = largestFeasible(
    (t) =>
      fitScale(
        shift(crop, dx * (1 - t), dy * (1 - t)),
        angleDeg,
        imageWidth,
        imageHeight,
      ) >= 1,
  );
  return shift(crop, dx * (1 - slack), dy * (1 - slack));
}

export function rotatedSize(
  width: number,
  height: number,
  rotation: number,
): [number, number] {
  return rotation % 180 === 0 ? [width, height] : [height, width];
}

export function turnCrop(crop: CropRect): CropRect {
  return {
    left: 1 - crop.bottom,
    top: crop.left,
    right: 1 - crop.top,
    bottom: crop.right,
  };
}

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
  const cx = clamp(center(crop).x, halfWidth);
  const cy = clamp(center(crop).y, halfHeight);
  return constrainCrop(
    boxAround(cx, cy, halfWidth, halfHeight),
    angleDeg,
    imageWidth,
    imageHeight,
  );
}

const MIN_CROP_SIZE = 0.05;

export function snapCropEdges(crop: CropRect, epsilon: number): CropRect {
  const snap = (value: number) =>
    Math.abs(value) < epsilon ? 0 : Math.abs(value - 1) < epsilon ? 1 : value;
  return {
    left: snap(crop.left),
    top: snap(crop.top),
    right: snap(crop.right),
    bottom: snap(crop.bottom),
  };
}

function snapToBox(
  crop: CropRect,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const snapped = snapCropEdges(crop, 1e-4);
  return cropInsideImage(snapped, angleDeg, imageWidth, imageHeight)
    ? snapped
    : crop;
}

export function moveCrop(
  crop: CropRect,
  dx: number,
  dy: number,
  angleDeg: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const { cos, sin } = rotationTerms(angleDeg);
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
  const targetX = (center(crop).x + dx) * imageWidth;
  const targetY = (center(crop).y + dy) * imageHeight;
  const relX = targetX - pivotX;
  const relY = targetY - pivotY;
  const baseX = Math.min(Math.max(pivotX + relX * cos - relY * sin, loX), hiX);
  const baseY = Math.min(Math.max(pivotY + relX * sin + relY * cos, loY), hiY);
  const backX = baseX - pivotX;
  const backY = baseY - pivotY;
  const centerX = pivotX + backX * cos + backY * sin;
  const centerY = pivotY - backX * sin + backY * cos;
  return snapToBox(
    boxAround(
      centerX / imageWidth,
      centerY / imageHeight,
      halfWidth / imageWidth,
      halfHeight / imageHeight,
    ),
    angleDeg,
    imageWidth,
    imageHeight,
  );
}

export type CropHandle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";

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
    if (handle.includes("l"))
      left = Math.min(left + stepX, right - MIN_CROP_SIZE);
    if (handle.includes("r"))
      right = Math.max(right + stepX, left + MIN_CROP_SIZE);
    if (handle.includes("t"))
      top = Math.min(top + stepY, bottom - MIN_CROP_SIZE);
    if (handle.includes("b"))
      bottom = Math.max(bottom + stepY, top + MIN_CROP_SIZE);
    if (ratio !== null) {
      const heightFor = (width: number) =>
        (width * imageWidth) / ratio / imageHeight;
      if (handle === "t" || handle === "b") {
        const width = ((bottom - top) * imageHeight * ratio) / imageWidth;
        const centerX = (left + right) / 2;
        left = centerX - width / 2;
        right = centerX + width / 2;
      } else if (handle === "l" || handle === "r") {
        const height = heightFor(right - left);
        const centerY = (top + bottom) / 2;
        top = centerY - height / 2;
        bottom = centerY + height / 2;
      } else if (handle.includes("t")) {
        top = bottom - heightFor(right - left);
      } else {
        bottom = top + heightFor(right - left);
      }
    }
    return { left, top, right, bottom };
  };
  const fraction = largestFeasible((t) =>
    cropInsideImage(apply(t), angleDeg, imageWidth, imageHeight),
  );
  const resized = constrainCrop(
    apply(fraction),
    angleDeg,
    imageWidth,
    imageHeight,
  );
  return snapToBox(resized, angleDeg, imageWidth, imageHeight);
}

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
  return constrainCrop(
    boxAround(0.5, 0.5, width / imageWidth / 2, height / imageHeight / 2),
    angleDeg,
    imageWidth,
    imageHeight,
  );
}

export type CropDraft = {
  crop: CropRect;
  angle: number;
  rotation: number;
  aspect: string;
  flipped: boolean;
};

export const STRAIGHTEN_RANGE = 180;
export const STRAIGHTEN_SLIDER_RANGE = { min: -45, max: 45 };

export const signedAngle = (angle: number) =>
  `${angle > 0 ? "+" : ""}${angle.toFixed(1)}°`;

export const ASPECTS: [string, string][] = [
  ["free", "Free"],
  ["original", "Original"],
  ["transposed", "Transposed"],
  ["1:1", "1:1"],
  ["4:5", "4:5"],
  ["2:3", "2:3"],
  ["3:4", "3:4"],
  ["5:7", "5:7"],
  ["16:9", "16:9"],
  ["16:10", "16:10"],
  ["21:9", "21:9"],
];

function matchAspect(
  crop: CropRect,
  displayWidth: number,
  displayHeight: number,
): { aspect: string; flipped: boolean } {
  const ratio =
    ((crop.right - crop.left) * displayWidth) /
    ((crop.bottom - crop.top) * displayHeight);
  for (const flipped of [false, true]) {
    for (const [value] of ASPECTS) {
      const candidate = aspectRatioFor(
        value,
        flipped,
        displayWidth,
        displayHeight,
      );
      if (candidate !== null && Math.abs(candidate - ratio) < ratio * 0.005) {
        return { aspect: value, flipped };
      }
    }
  }
  return { aspect: "original", flipped: false };
}

export function draftFromEdit(
  edit: {
    crop?: CropRect | null;
    cropAngle?: number;
    rotation?: number;
  },
  imageWidth: number,
  imageHeight: number,
): CropDraft {
  const crop = edit.crop ?? fullCrop;
  const rotation = edit.rotation ?? 0;
  const [displayWidth, displayHeight] = rotatedSize(
    imageWidth,
    imageHeight,
    rotation,
  );
  return {
    crop,
    angle: edit.cropAngle ?? 0,
    rotation,
    ...matchAspect(crop, displayWidth, displayHeight),
  };
}

export function isIdentityDraft(draft: CropDraft): boolean {
  return isFullCrop(draft.crop) && draft.angle === 0 && draft.rotation === 0;
}

export function commitDraft(draft: CropDraft): {
  crop: CropRect | null;
  cropAngle: number;
  rotation: number;
} {
  const crop = snapCropEdges(draft.crop, 0.001);
  const identity = isFullCrop(crop) && draft.angle === 0;
  return {
    crop: identity ? null : crop,
    cropAngle: draft.angle,
    rotation: draft.rotation,
  };
}

export function draftWithAngle(
  draft: CropDraft,
  angle: number,
  imageWidth: number,
  imageHeight: number,
): CropDraft {
  const clamped = Math.min(
    Math.max(angle, -STRAIGHTEN_RANGE),
    STRAIGHTEN_RANGE,
  );
  return {
    ...draft,
    angle: clamped,
    crop: constrainCrop(draft.crop, clamped, imageWidth, imageHeight),
  };
}
