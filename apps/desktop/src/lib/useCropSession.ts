import { useState } from "react";
import type { Edit, ImageFile } from "./core";
import { type CropDraft, commitDraft, draftFromEdit } from "./crop";

export function useCropSession(
  loupePhoto: ImageFile | null,
  edit: Edit,
  changeEdit: (image: ImageFile, edit: Edit) => void,
) {
  const [stored, setStored] = useState<{
    path: string;
    draft: CropDraft;
  } | null>(null);
  const current = stored?.path === loupePhoto?.path ? stored : null;
  // leaving the photo or closing the loupe ends the crop instead of parking it
  if (stored && !current) setStored(null);
  const draft = current?.draft ?? null;

  const set = (next: CropDraft) => {
    if (loupePhoto) setStored({ path: loupePhoto.path, draft: next });
  };

  return {
    draft,
    set,
    enter: () => {
      if (loupePhoto) {
        set(draftFromEdit(edit, loupePhoto.width, loupePhoto.height));
      }
    },
    apply: () => {
      if (!draft || !loupePhoto) return;
      changeEdit(loupePhoto, { ...edit, ...commitDraft(draft) });
      setStored(null);
    },
    cancel: () => setStored(null),
  };
}

export type CropSession = ReturnType<typeof useCropSession>;
