import { type Edit, framing } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// A crop rect is normalized against its own turned frame, so the target keeps its own.
// White balance is Kelvin on raw but incremental elsewhere, so it stays behind.
// Denoise only exists on raw, where null means the decoder's per-image amount.
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
