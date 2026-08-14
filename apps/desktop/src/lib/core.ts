import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type CurvePoint, isIdentityCurve } from "./curve";

// temperature/tint: Kelvin and green–magenta offset for raw files where
// null means "as shot"; incremental -100..100 for embedded formats. The core
// omits null fields when encoding, so read them with `?? null`.
export type Edit = {
  exposure: number;
  highlights: number;
  shadows: number;
  temperature?: number | null;
  tint?: number | null;
  vibrance: number;
  saturation: number;
  curveRGB: CurvePoint[];
  curveRed: CurvePoint[];
  curveGreen: CurvePoint[];
  curveBlue: CurvePoint[];
};

export const identityEdit: Edit = Object.freeze({
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: null,
  tint: null,
  vibrance: 0,
  saturation: 0,
  curveRGB: [],
  curveRed: [],
  curveGreen: [],
  curveBlue: [],
});

export function isIdentityEdit(edit: Edit): boolean {
  return (
    edit.exposure === 0 &&
    edit.highlights === 0 &&
    edit.shadows === 0 &&
    (edit.temperature ?? null) === null &&
    (edit.tint ?? null) === null &&
    edit.vibrance === 0 &&
    edit.saturation === 0 &&
    isIdentityCurve(edit.curveRGB) &&
    isIdentityCurve(edit.curveRed) &&
    isIdentityCurve(edit.curveGreen) &&
    isIdentityCurve(edit.curveBlue)
  );
}

// Stable string for react-query keys and mock cache paths.
export function editKey(edit: Edit): string {
  const curve = (points: CurvePoint[]) =>
    points.map((point) => `${point.x},${point.y}`).join(";");
  return [
    edit.exposure,
    edit.highlights,
    edit.shadows,
    edit.temperature ?? "",
    edit.tint ?? "",
    edit.vibrance,
    edit.saturation,
    curve(edit.curveRGB),
    curve(edit.curveRed),
    curve(edit.curveGreen),
    curve(edit.curveBlue),
  ].join("|");
}

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
};

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

export type WhiteBalanceResult = {
  temperature: number | null;
  tint: number | null;
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
};

export function coreRequest<T>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>("core_request", { method, params });
}

function placeholderFor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) {
    hash = (hash * 31 + path.charCodeAt(i)) % 360;
  }
  const hue = hash;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0' stop-color='hsl(${hue} 45% 42%)'/>
<stop offset='0.55' stop-color='hsl(${(hue + 28) % 360} 38% 26%)'/>
<stop offset='1' stop-color='hsl(${(hue + 55) % 360} 30% 14%)'/>
</linearGradient>
<radialGradient id='v' cx='0.5' cy='0.42' r='0.75'>
<stop offset='0.55' stop-color='rgba(0,0,0,0)'/><stop offset='1' stop-color='rgba(0,0,0,0.45)'/>
</radialGradient></defs>
<rect width='600' height='400' fill='url(#g)'/>
<rect width='600' height='400' fill='url(#v)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return placeholderFor(path);
  }
}
