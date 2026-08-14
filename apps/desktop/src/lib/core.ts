import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type ImageFile = {
  path: string;
  rel: string;
  ext: string;
  size: number;
  mtime: number;
  rating: number;
  exposure: number;
  width: number;
  height: number;
};

export type SetRatingResult = {
  rating: number;
  generation: number;
};

export type SetExposureResult = {
  exposure: number;
  generation: number;
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
