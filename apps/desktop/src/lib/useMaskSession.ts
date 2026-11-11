import { useEffect, useState } from "react";
import {
  type Edit,
  type ImageFile,
  identityAdjust,
  type LocalAdjust,
  type Mask,
  type MaskShape,
} from "./core";

// as long as --animate-mask-flash in index.css
const FLASH_MS = 1600;

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
) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [overlay, setOverlay] = useState(false);
  const current = stored?.path === loupePhoto?.path ? stored : null;
  // another photo starts on Photo with the field closed
  if (stored && !current) setStored(null);

  const byId = (id: string | null | undefined) =>
    edit.masks.find((mask) => mask.id === id) ?? null;
  const target = byId(current?.target);
  const creating = current?.creating ?? false;
  const flash = current?.flash ?? null;

  useEffect(() => {
    if (flash === null) return;
    const timer = window.setTimeout(
      () => setStored((now) => now && { ...now, flash: null }),
      FLASH_MS,
    );
    return () => clearTimeout(timer);
  }, [flash]);

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

  const held = byId(current?.row) ?? (overlay ? target : null);
  const shown: MaskShape | null = creating
    ? (current?.chip ?? null)
    : (held ?? byId(flash));

  return {
    target,
    creating,
    shown,
    fading: !creating && held === null,
    toggleField: () => patch({ creating: !creating, chip: null }),
    cancel: () => patch({ creating: false, chip: null }),
    hoverChip: (chip: MaskShape | null) => patch({ chip }),
    hoverRow: (row: string | null) => patch({ row }),
    add: (shape: MaskShape) => {
      const id = crypto.randomUUID().slice(0, 8);
      write([
        ...edit.masks,
        { ...shape, id, hidden: false, adjust: identityAdjust },
      ]);
      patch({ target: id, creating: false, chip: null, flash: id });
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
    toggleOverlay: () => setOverlay((on) => !on),
  };
}

export type MaskSession = ReturnType<typeof useMaskSession>;
