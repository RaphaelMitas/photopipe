import type { Models } from "./core";

export function noModels(clicks: number): Models {
  return {
    entries: [],
    tasks: { findRegion: { clicks }, fillHole: { model: "lama-1" } },
  };
}
