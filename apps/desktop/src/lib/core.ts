import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type CurvePoint, isIdentityCurve } from "./curve";
import { placeholderFor } from "./placeholder";

// Normalized crop in the unit square with a top-left origin, crs-style.
export type CropRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// Mirrors core Edit.swift, which documents the units. The core omits null
// fields when encoding, so read them with `?? null`.
export type Edit = {
  exposure: number;
  highlights: number;
  shadows: number;
  temperature?: number | null;
  tint?: number | null;
  denoise?: number | null;
  vibrance: number;
  saturation: number;
  curveRGB: CurvePoint[];
  curveRed: CurvePoint[];
  curveGreen: CurvePoint[];
  curveBlue: CurvePoint[];
  crop?: CropRect | null;
  cropAngle?: number;
  rotation?: number;
};

export const identityEdit: Edit = Object.freeze({
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: null,
  tint: null,
  denoise: null,
  vibrance: 0,
  saturation: 0,
  curveRGB: [],
  curveRed: [],
  curveGreen: [],
  curveBlue: [],
  crop: null,
  cropAngle: 0,
  rotation: 0,
});

export function isIdentityEdit(edit: Edit): boolean {
  return (
    edit.exposure === 0 &&
    edit.highlights === 0 &&
    edit.shadows === 0 &&
    (edit.temperature ?? null) === null &&
    (edit.tint ?? null) === null &&
    (edit.denoise ?? null) === null &&
    edit.vibrance === 0 &&
    edit.saturation === 0 &&
    isIdentityCurve(edit.curveRGB) &&
    isIdentityCurve(edit.curveRed) &&
    isIdentityCurve(edit.curveGreen) &&
    isIdentityCurve(edit.curveBlue) &&
    (edit.crop ?? null) === null &&
    (edit.cropAngle ?? 0) === 0 &&
    (edit.rotation ?? 0) === 0
  );
}

// Stable string for react-query keys and mock cache paths.
export function editKey(edit: Edit): string {
  const curve = (points: CurvePoint[]) =>
    points.map((point) => `${point.x},${point.y}`).join(";");
  const crop = edit.crop
    ? `${edit.crop.left},${edit.crop.top},${edit.crop.right},${edit.crop.bottom}`
    : "";
  return [
    edit.exposure,
    edit.highlights,
    edit.shadows,
    edit.temperature ?? "",
    edit.tint ?? "",
    edit.denoise ?? "",
    edit.vibrance,
    edit.saturation,
    curve(edit.curveRGB),
    curve(edit.curveRed),
    curve(edit.curveGreen),
    curve(edit.curveBlue),
    crop,
    edit.cropAngle ?? 0,
    edit.rotation ?? 0,
  ].join("|");
}

// `enriched` is false while rating, edit and dimensions are still the
// placeholders the core's directory walk left behind.
export type ImageFile = {
  path: string;
  rel: string;
  ext: string;
  size: number;
  mtime: number;
  rating: number;
  edit: Edit;
  width: number;
  height: number;
  // Vision's aesthetic score, -1..1. The core omits it entirely for a photo it
  // has not rated, so read it through `normalizeImage` and never off the wire.
  score?: number | null;
  enriched: boolean;
};

/// The core leaves nulls out when it encodes, so an unrated photo arrives with
/// no `score` at all. Everything downstream compares against null, so the field
/// is filled in here, once, where the images come in.
export function normalizeImage(image: ImageFile): ImageFile {
  return image.score === undefined ? { ...image, score: null } : image;
}

export function isRawFile(file: { ext: string }): boolean {
  return ["arw", "dng", "cr2", "cr3", "nef", "raf", "orf", "rw2"].includes(
    file.ext.toLowerCase(),
  );
}

export type SetRatingResult = {
  rating: number;
  generation: number;
};

export type SetEditResult = {
  edit: Edit;
  generation: number;
};

export type RawDefaultsResult = {
  temperature: number | null;
  tint: number | null;
  denoise: number | null;
};

export type Shoot = {
  name: string;
  path: string;
  day: string | null;
  project: string | null;
  imageCount: number;
  notes: string;
  cover: string | null;
  coverPath: string | null;
  indexed: boolean;
};

export type ExportFormat = "original" | "jpeg";

export type CreateProjectResult = {
  shoot: string;
  path: string;
  generation: number;
};

export type SetRootResult = {
  shoots: number;
  files: number;
  generation: number;
};
export type StatusResult = {
  generation: number;
  root: string | null;
  shoots: number;
  scanning: boolean;
  filesFound: number;
  filesEnriched: number;
  // Only the shoots that changed since the `since` the caller passed, so a
  // library that is still indexing doesn't refetch every open shoot.
  changedShoots?: string[];
};

export function coreRequest<T>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>("core_request", { method, params });
}

export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return placeholderFor(path);
  }
}
