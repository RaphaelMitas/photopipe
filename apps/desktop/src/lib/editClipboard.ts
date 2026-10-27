import { type Edit, framing } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// White balance is Kelvin on raw but incremental everywhere else, so it does
// not survive the trip.
// Denoise only exists on raw, and null there means the decoder's own per-image
// amount, so it cannot be carried onto a JPEG either.
export function pasteEdit(
  target: Edit,
  clipboard: EditClipboard,
  targetRaw: boolean,
): Edit {
  const pasted: Edit = { ...clipboard.edit, ...framing(target) };
  if (targetRaw === clipboard.raw) return pasted;
  return {
    ...pasted,
    temperature: target.temperature ?? null,
    tint: target.tint ?? null,
    denoise: target.denoise ?? null,
  };
}
