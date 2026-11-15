import { type Edit, framing, type Mask } from "./core";

export type EditClipboard = {
  path: string;
  edit: Edit;
  raw: boolean;
};

export const travels = (mask: Mask) => mask.source !== "click";

export function pasteEdit(
  target: Edit,
  clipboard: EditClipboard,
  targetRaw: boolean,
): Edit {
  const stays = target.masks.filter((mask) => !travels(mask));
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
