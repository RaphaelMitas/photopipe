import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback } from "react";
import { type Edit, editKey, isRawFile } from "./core";
import { describeEdit } from "./describeEdit";
import { type HistoryAction, pushHistory } from "./history";
import {
  cachedImage,
  currentEdits,
  type EditWrite,
  type PasteResult,
  usePasteEdits,
  useSetEdit,
  useSetRating,
} from "./queries";

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  // stable across renders, so an entry can hold on to them
  const { mutateAsync: setRating } = useSetRating(shoot);
  const { mutateAsync: setEdit } = useSetEdit(shoot);
  const { mutateAsync: pasteEdits } = usePasteEdits(shoot);

  const cached = useCallback(
    (path: string) => cachedImage(queryClient, shoot, path),
    [queryClient, shoot],
  );

  const rate = useCallback(
    (path: string, rating: number) => {
      const image = cached(path);
      if (!image || image.rating === rating) return;
      const write = (value: number) => setRating({ path, rating: value });
      record(
        write,
        image.rating,
        rating,
        {
          icon: Star,
          label: "Rating",
          detail: rating === 0 ? "cleared" : "★".repeat(rating),
          paths: [path],
        },
        // before the core has read the file, the old rating is a placeholder
        image.enriched,
      );
    },
    [cached, setRating],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const image = cached(path);
      if (!image || editKey(image.edit) === editKey(edit)) return;
      const before = image.edit;
      const write = (value: Edit) => setEdit({ path, edit: value });
      record(write, before, edit, {
        ...describeEdit(before, edit, isRawFile(image)),
        paths: [path],
      });
    },
    [cached, setEdit],
  );

  const paste = useCallback(
    (writes: EditWrite[]): Promise<PasteResult> => {
      const previous = Array.from(
        currentEdits(
          queryClient,
          shoot,
          writes.map((write) => write.path),
        ),
        ([path, edit]) => ({ path, edit }),
      );
      // The batch resolves even when every write failed; a step must not.
      const landed = (batch: Promise<PasteResult>) =>
        batch.then((result) => {
          if (result.written === 0) throw new Error("nothing pasted");
        });
      const among = (all: EditWrite[], paths: string[]) =>
        pasteEdits(all.filter((write) => paths.includes(write.path)));
      const batch = pasteEdits(writes);
      // Recorded up front: ⌘Z during a long paste has to mean this paste.
      void pushHistory({
        icon: ClipboardPaste,
        label: "Paste settings",
        paths: writes.map((write) => write.path),
        undo: (paths) => landed(among(previous, paths)),
        redo: (paths) => landed(among(writes, paths)),
        written: landed(batch),
      });
      return batch;
    },
    [queryClient, shoot, pasteEdits],
  );

  return { rate, writeEdit, paste };
}

function record<T>(
  write: (value: T) => Promise<unknown>,
  before: T,
  after: T,
  action: Omit<HistoryAction, "undo" | "redo" | "written">,
  undoable = true,
) {
  const written = write(after);
  // the mutation's onError already rolls back and toasts
  void written.catch(() => {});
  if (!undoable) return;
  void pushHistory({
    ...action,
    undo: () => write(before),
    redo: () => write(after),
    written,
  });
}
