import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Stage = "raw" | "denoised" | "export";

export type FileRecord = {
  path: string;
  ext: string;
  stage: Stage;
  size: number;
  mtime: number;
};

export type ImageGroup = {
  stem: string;
  stage: Stage;
  /** XMP star rating, 0 = unrated. */
  rating: number;
  /** Upright pixel dimensions of the display file; 3:2 fallback core-side. */
  width: number;
  height: number;
  files: FileRecord[];
};

export type SetRatingResult = {
  rating: number;
  generation: number;
};

export type Shoot = {
  name: string;
  path: string;
  day: string | null;
  project: string | null;
  counts: Record<Stage, number>;
  imageCount: number;
  /** From photopipe.json; empty when the project has none. */
  notes: string;
  /** Stem of the chosen cover, if the project names one. */
  cover: string | null;
  /** File to thumbnail for the card: chosen cover, else the first image. */
  coverPath: string | null;
};

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

/// Stand-in artwork for the browser, where there is no asset protocol and no
/// real photos: a gradient derived from the path, so every image looks
/// different and the same image looks the same each run. Used by e2e and by
/// the README screenshots; in the app this branch never runs.
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

/// Asset-protocol URL for a local file; stand-in artwork outside Tauri.
export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return placeholderFor(path);
  }
}
