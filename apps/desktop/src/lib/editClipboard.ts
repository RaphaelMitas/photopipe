import { type Edit, framing, type Mask } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

// a click points at one photo, where a chip names something every photo has
export const travels = (mask: Mask) => mask.source !== "click";

// A crop rect is normalized against its own turned frame, so the target keeps its own.
// White balance is Kelvin on raw but incremental elsewhere, so it stays behind.
// Denoise only exists on raw, where null means the decoder's per-image amount.
export function pasteEdit(
  target: Edit,
  clipboard: EditClipboard,
  targetRaw: boolean,
): Edit {
  const stays = target.masks.filter((mask) => !travels(mask));
  // back on its own photo a click mask keeps its place among the chips
  const copied = clipboard.edit.masks.flatMap((mask) =>
    travels(mask) ? [mask] : stays.filter((own) => own.id === mask.id),
  );
  const pasted: Edit = {
    ...clipboard.edit,
    ...framing(target),
    masks: [...copied, ...stays.filter((own) => !copied.includes(own))],
  };
  if (targetRaw === clipboard.raw) return pasted;
  return {
    ...pasted,
    temperature: target.temperature ?? null,
    tint: target.tint ?? null,
    denoise: target.denoise ?? null,
  };
}
