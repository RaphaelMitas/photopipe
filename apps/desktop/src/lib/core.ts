import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { CurvePoint } from "./curve";
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
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
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
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
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
  return editKey(edit) === editKey(identityEdit);
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
    edit.whites,
    edit.blacks,
    edit.texture,
    edit.clarity,
    edit.dehaze,
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
  // Vision's aesthetic score, -1..1, null for a photo it has not rated.
  score: number | null;
  enriched: boolean;
};

/// The core omits nulls and defaulted fields when it encodes, so an unrated
/// photo arrives with no `score` and an untouched one with no `whites`.
type WireImage = Omit<ImageFile, "score" | "edit"> & {
  score?: number | null;
  edit: Partial<Edit>;
};

export function normalizeImage(image: WireImage): ImageFile {
  return {
    ...image,
    score: image.score ?? null,
    edit: { ...identityEdit, ...image.edit },
  };
}

export function isRawFile(file: { ext: string }): boolean {
  return ["arw", "dng", "cr2", "cr3", "nef", "raf", "orf", "rw2"].includes(
    file.ext.toLowerCase(),
  );
}

export type Shoot = {
  name: string;
  path: string;
  day: string | null;
  imageCount: number;
  notes: string;
  cover: string | null;
  coverPath: string | null;
  indexed: boolean;
};

type WireShoot = Omit<Shoot, "day" | "cover" | "coverPath"> &
  Partial<Pick<Shoot, "day" | "cover" | "coverPath">>;

export function normalizeShoot(shoot: WireShoot): Shoot {
  return {
    ...shoot,
    day: shoot.day ?? null,
    cover: shoot.cover ?? null,
    coverPath: shoot.coverPath ?? null,
  };
}

export type ExportFormat = "original" | "jpeg";

export type ExportProgress = {
  id: string;
  done: number;
  failed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
  archiving: boolean;
  error?: string | null;
  failures: string[];
};

export type SetRootResult = {
  shoots: number;
  files: number;
  generation: number;
};

export type StatusResult = {
  generation: number;
  root?: string | null;
  shoots: number;
  scanning: boolean;
  filesFound: number;
  filesEnriched: number;
  // Only the shoots that changed since the `since` the caller passed, so a
  // library that is still indexing doesn't refetch every open shoot.
  changedShoots?: string[];
};

type CachePath = { cachePath: string };

export type CoreMethods = {
  listShoots: { params: undefined; result: { shoots: WireShoot[] } };
  listImages: { params: { shoot: string }; result: { images: WireImage[] } };
  scoreShoot: {
    params: { shoot: string };
    result: { done: number; total: number; running: boolean };
  };
  thumbnail: { params: { path: string; maxPixel: number }; result: CachePath };
  render: {
    params: {
      path: string;
      edit: Edit;
      maxPixel: number;
      viewport?: CropRect;
      decoderVersion?: number;
    };
    result: CachePath;
  };
  rawDefaults: {
    params: { path: string; decoderVersion: number };
    result: {
      temperature: number | null;
      tint: number | null;
      denoise: number | null;
    };
  };
  decoderSupport: {
    params: { paths: string[] };
    result: { raw9: number; rawTotal: number };
  };
  decoderAvailability: { params: undefined; result: { raw9: boolean | null } };
  setRating: {
    params: { shoot: string | null; path: string; rating: number };
    result: { rating: number; generation: number };
  };
  setEdit: {
    params: { shoot: string | null; path: string; edit: Edit };
    result: { edit: Partial<Edit>; generation: number };
  };
  trash: {
    params: { shoot: string | null; paths: string[] };
    result: { files: number; generation: number };
  };
  createProject: {
    params: { name: string; notes: string };
    result: { shoot: string; path: string; generation: number };
  };
  updateProject: {
    params: {
      shoot: string;
      name: string;
      day: string | null;
      notes: string;
      cover: string | null;
    };
    result: { shoot: string; generation: number };
  };
  captureDate: { params: { path: string }; result: { day: string | null } };
  exportFiles: {
    params: {
      shoot: string;
      paths: string[];
      destination: string;
      zip: boolean;
      flatten: boolean;
      format: ExportFormat;
      quality: number;
      decoderVersion: number;
    };
    result: ExportProgress;
  };
  importFiles: {
    params: { shoot: string; paths: string[] };
    result: ExportProgress;
  };
  exportStatus: { params: { id: string }; result: ExportProgress };
  cancelExport: { params: { id: string }; result: ExportProgress };
  status: { params: { since: number | null }; result: StatusResult };
};

export function coreRequest<K extends keyof CoreMethods>(
  method: K,
  ...[params]: CoreMethods[K]["params"] extends undefined
    ? []
    : [CoreMethods[K]["params"]]
): Promise<CoreMethods[K]["result"]> {
  return invoke("core_request", { method, params });
}

export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return placeholderFor(path);
  }
}
