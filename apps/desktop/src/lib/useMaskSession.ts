import { useState } from "react";
import {
  type Edit,
  type ImageFile,
  identityAdjust,
  type LocalAdjust,
  type Mask,
  type MaskPoint,
  type MaskShape,
} from "./core";

type Stored = {
  path: string;
  target: string | null;
  creating: boolean;
  chip: MaskShape | null;
  row: string | null;
  flash: string | null;
};

export function useMaskSession(
  loupePhoto: ImageFile | null,
  edit: Edit,
  changeEdit: (image: ImageFile, edit: Edit) => void,
  panelOpen: boolean,
) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [overlay, setOverlay] = useState(false);
  const current =
    panelOpen && stored?.path === loupePhoto?.path ? stored : null;
  // another photo or a closed panel starts over on Photo with the field closed
  if (stored && !current) setStored(null);

  const byId = (id: string | null | undefined) =>
    edit.masks.find((mask) => mask.id === id) ?? null;
  const target = byId(current?.target);
  const creating = current?.creating ?? false;
  const flash = current?.flash ?? null;

  const patch = (change: Partial<Stored>) => {
    if (!loupePhoto) return;
    setStored({
      target: null,
      creating: false,
      chip: null,
      row: null,
      flash: null,
      ...current,
      path: loupePhoto.path,
      ...change,
    });
  };
  const write = (masks: Mask[]) => {
    if (loupePhoto) changeEdit(loupePhoto, { ...edit, masks });
  };
  const change = (id: string, partial: Partial<Mask>) =>
    write(
      edit.masks.map((mask) =>
        mask.id === id ? { ...mask, ...partial } : mask,
      ),
    );

  const append = (shape: MaskShape) => {
    const id = crypto.randomUUID().slice(0, 8);
    write([
      ...edit.masks,
      { ...shape, id, hidden: false, adjust: identityAdjust },
    ]);
    return id;
  };

  const held: MaskShape | null = creating
    ? (current?.chip ?? null)
    : (byId(current?.row) ?? (overlay ? target : null));

  return {
    target,
    creating,
    shown: held ?? byId(flash),
    fading: held === null,
    toggleField: () => patch({ creating: !creating, chip: null }),
    cancel: () => patch({ creating: false, chip: null }),
    hoverChip: (chip: MaskShape | null) => patch({ chip }),
    hoverRow: (row: string | null) => patch({ row, flash: null }),
    add: (shape: MaskShape) => {
      const id = append(shape);
      patch({ target: id, creating: false, chip: null, flash: id });
    },
    // the field stays open, so the next click on the photo starts another mask
    click: (point: MaskPoint) => {
      const id = append({ source: "click", inverted: false, points: [point] });
      patch({ target: id, flash: id });
    },
    refine: (id: string, point: MaskPoint) => {
      const mask = byId(id);
      if (!mask) return;
      change(id, { points: [...mask.points, point] });
      patch({ flash: id });
    },
    select: (id: string | null) =>
      patch({ target: id, creating: false, chip: null, flash: id }),
    toggleHidden: (mask: Mask) => change(mask.id, { hidden: !mask.hidden }),
    invert: (mask: Mask) => {
      change(mask.id, { inverted: !mask.inverted });
      patch({ flash: mask.id });
    },
    remove: (mask: Mask) => {
      write(edit.masks.filter((entry) => entry.id !== mask.id));
      patch({ row: null });
    },
    adjust: (partial: Partial<LocalAdjust>) => {
      if (target)
        change(target.id, { adjust: { ...target.adjust, ...partial } });
    },
    toggleOverlay: () => {
      setOverlay((on) => !on);
      patch({ flash: null });
    },
    endFlash: () => patch({ flash: null }),
  };
}

export type MaskSession = ReturnType<typeof useMaskSession>;
