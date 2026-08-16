import type { Edit } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// A crop rect is normalized against its own turned frame, and white balance is
// Kelvin on raw but incremental everywhere else — neither survives the trip.
// Denoise only exists on raw, and null there means the decoder's own per-image
// amount, so it cannot be carried onto a JPEG either.
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
    denoise: target.denoise ?? null,
  };
}
