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

const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='%23262626'/%3E%3C/svg%3E";

/// Asset-protocol URL for a local file; placeholder outside Tauri (e2e browser).
export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return PLACEHOLDER;
  }
}
