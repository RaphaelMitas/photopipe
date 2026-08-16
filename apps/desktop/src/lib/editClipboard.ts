import type { Edit } from "./core";

// The look copied off a photo: its whole edit plus whether that photo was raw,
// which is what decides whether its white balance means anything elsewhere.
export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// Pasting makes the target look like the copied photo, minus the framing:
// crop, straighten and rotation stay with the photo they were made for,
// because a crop rect is normalized against its own turned frame and means
// something different on a photo of another shape. Temperature and tint are
// Kelvin on raw and incremental -100..100 everywhere else, so they only cross
// between photos of the same kind.
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
