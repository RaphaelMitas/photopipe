import type { Edit } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// A crop rect is normalized against its own turned frame, and white balance is
// Kelvin on raw but incremental everywhere else — neither survives the trip.
export function pasteEdit(
  target: Edit,
  clipboard: EditClipboard,
  targetRaw: boolean,
): Edit {
  const pasted: Edit = {
    ...clipboard.edit,
    crop: target.crop ?? null,
    cropAngle: target.cropAngle ?? 0,
    rotation: target.rotation ?? 0,
  };
  if (targetRaw === clipboard.raw) return pasted;
  return {
    ...pasted,
    temperature: target.temperature ?? null,
    tint: target.tint ?? null,
  };
}
